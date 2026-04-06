require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { OpenAI } = require('openai');

const app = express();

// 🔐 CORS (ajuste o origin depois com seu ID da extensão/frontend)
app.use(cors({
    origin: "*"
}));

app.use(express.json());

// 🚫 Rate limit (proteção básica)
app.use(rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 30,
    message: { error: "Too many requests. Please try again in 1 minute." }
}));

// 🔑 OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// ⚡ Cache com TTL
const cachePrivacidade = {};
const CACHE_TTL = 1000 * 60 * 60; // 1 hora

// 🔍 Função para limpar domínio
function limparDominio(site) {
    return site
        .replace(/^https?:\/\//, "")
        .split("/")[0]
        .toLowerCase();
}

app.get('/analisar', async (req, res) => {
    const inicio = Date.now();
    let { site } = req.query;

    // 🛑 Validação de entrada
    if (!site || typeof site !== "string") {
        return res.status(400).json({
            error: "Parameter 'site' is required."
        });
    }

    site = limparDominio(site);
    console.log(`\n🔍 Analisando site: ${site}`);

    // ⚡ Verifica cache com TTL
    const cache = cachePrivacidade[site];
    if (cache && (Date.now() - cache.timestamp < CACHE_TTL)) {
        console.log(`⚡ [CACHE HIT] ${site}`);
        return res.status(200).json({
            ...cache.data,
            tempoResposta: `${Date.now() - inicio}ms`
        });
    }

    try {
        let dadosParaIA = "";
        let fonteUtilizada = "";
        let notaExclusivaTosdr = "?"; // A nota padrão é '?' se não achar nada

        console.log(`🌐 Buscando no ToS;DR...`);

        // ⏱️ Timeout no fetch (evita que o servidor trave se o ToS;DR demorar)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        let tosdrData = null;
        try {
            const tosdrResponse = await fetch(`https://api.tosdr.org/search/v4/?query=${site}`, {
                signal: controller.signal
            });
            tosdrData = await tosdrResponse.json();
        } catch (fetchErro) {
            console.log(`⚠️ Erro/Timeout na API do ToS;DR. Seguindo sem dados prévios.`);
        } finally {
            clearTimeout(timeout);
        }

        // Verifica se vieram dados válidos do ToS;DR
        if (
            tosdrData &&
            tosdrData.parameters &&
            tosdrData.parameters.services &&
            tosdrData.parameters.services.length > 0
        ) {
            const servico = tosdrData.parameters.services[0];
            notaExclusivaTosdr = servico.rating && servico.rating.letter ? servico.rating.letter : '?';

            console.log(`✅ ToS;DR encontrado: ${servico.name} (${notaExclusivaTosdr})`);

            fonteUtilizada = "ToS;DR Database + Artificial Intelligence";
            dadosParaIA = `The site ${site} has a Score of ${notaExclusivaTosdr} on ToS;DR. Raw data: ${JSON.stringify(servico)}`;

        } else {
            console.log(`⚠️ Sem dados no ToS;DR`);

            fonteUtilizada = "Exclusive by Artificial Intelligence";
            dadosParaIA = `There is no data on ToS;DR for the site ${site}. Analyze based on your knowledge of this company's privacy terms.`;
        }

        console.log(`⏳ Consultando IA...`);

        const resposta = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `You are a lawyer specializing in cybersecurity and data privacy.
Your mission is to generate a simple and direct summary for the end user.
Your response MUST strictly be a valid JSON object.

Analysis rules:
1. "score": Return EXACTLY the ToS;DR rating provided in the database. Do not calculate or invent a new score. If no score is provided, return "?".
2. "alertas": A list containing exactly 3 to 6 critical points in ENGLISH. Be objective! (e.g., "Shares your data with marketing partners").`
                },
                {
                    role: "user",
                    content: `Database for analysis:\n${dadosParaIA}\n\nStrictly return the JSON: {"score": "Score", "alertas": ["Alert 1", "Alert 2", "Alert 3"]}`
                }
            ]
        });

        // 🧠 Proteção contra JSON inválido da IA
        let dadosFormatados;
        try {
            dadosFormatados = JSON.parse(resposta.choices[0].message.content);
        } catch {
            throw new Error("Resposta inválida da IA");
        }

        // 🔒 Trava de Segurança Final: Força o score real caso a IA tenha alucinado
        dadosFormatados.score = notaExclusivaTosdr; 
        
        dadosFormatados.fonte = fonteUtilizada;
        dadosFormatados.tempoResposta = `${Date.now() - inicio}ms`;

        // 💾 Salva no cache
        cachePrivacidade[site] = {
            data: dadosFormatados,
            timestamp: Date.now()
        };

        console.log(`💾 Cache salvo | Score Final: ${dadosFormatados.score}`);

        res.status(200).json(dadosFormatados);

    } catch (erro) {
        console.error("❌ Erro:", erro.message);

        res.status(500).json({
            score: "?",
            alertas: [
                "Internal error while analyzing the site.",
                "Please try again in a few moments."
            ],
            fonte: "Server Error",
            tempoResposta: `${Date.now() - inicio}ms`
        });
    }
});

// 🚀 Inicialização
const PORTA = process.env.PORT || 3000;

app.listen(PORTA, () => {
    console.log(`🚀 Servidor rodando na porta ${PORTA}`);
});
