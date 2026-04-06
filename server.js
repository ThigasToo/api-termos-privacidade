require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { OpenAI } = require('openai');

const app = express();

// 🔐 CORS (ajuste o origin depois com seu ID da extensão)
app.use(cors({
    origin: "*"
}));

app.use(express.json());

// 🚫 Rate limit (proteção básica)
app.use(rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 30
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
        .replace(/https?:\/\//, "")
        .split("/")[0]
        .toLowerCase();
}

app.get('/analisar', async (req, res) => {
    const inicio = Date.now();

    let { site } = req.query;

    // 🛑 Validação de entrada
    if (!site || typeof site !== "string") {
        return res.status(400).json({
            error: "Parâmetro 'site' é obrigatório"
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

        console.log(`🌐 Buscando no ToS;DR...`);

        // ⏱️ Timeout no fetch
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const tosdrResponse = await fetch(`https://api.tosdr.org/search/v4/?query=${site}`, {
            signal: controller.signal
        });

        clearTimeout(timeout);

        const tosdrData = await tosdrResponse.json();

        if (
            tosdrData.parameters &&
            tosdrData.parameters.services &&
            tosdrData.parameters.services.length > 0
        ) {
            const servico = tosdrData.parameters.services[0];
            const notaTosdr = servico.rating ? servico.rating.letter : 'Desconhecida';

            console.log(`✅ ToS;DR encontrado: ${servico.name} (${notaTosdr})`);

            fonteUtilizada = "Base de dados ToS;DR + Inteligência Artificial";

            dadosParaIA = `O site ${site} possui a Nota ${notaTosdr} no ToS;DR.
            Dados: ${JSON.stringify(servico)}.
            Traduza para português, ignore irrelevâncias e extraia os pontos críticos.`;

        } else {
            console.log(`⚠️ Sem dados no ToS;DR`);

            fonteUtilizada = "Exclusiva por Inteligência Artificial";

            dadosParaIA = `Não há dados no ToS;DR. Analise com base no seu conhecimento sobre ${site}.`;
        }

        console.log(`⏳ Consultando IA...`);

        const resposta = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `Você é um especialista em privacidade e cibersegurança.
Responda SOMENTE com JSON válido.

Formato:
{
  "score": "A|B|C|D|?",
  "alertas": ["..."]
}

Regras:
- 3 a 6 alertas
- Português do Brasil
- Seja direto`
                },
                {
                    role: "user",
                    content: `Base:\n${dadosParaIA}`
                }
            ]
        });

        // 🧠 Proteção contra JSON inválido
        let dadosFormatados;
        try {
            dadosFormatados = JSON.parse(resposta.choices[0].message.content);
        } catch {
            throw new Error("Resposta inválida da IA");
        }

        dadosFormatados.fonte = fonteUtilizada;
        dadosFormatados.tempoResposta = `${Date.now() - inicio}ms`;

        // 💾 Salva no cache
        cachePrivacidade[site] = {
            data: dadosFormatados,
            timestamp: Date.now()
        };

        console.log(`💾 Cache salvo | Score: ${dadosFormatados.score}`);

        res.status(200).json(dadosFormatados);

    } catch (erro) {
        console.error("❌ Erro:", erro.message);

        res.status(200).json({
            score: "?",
            alertas: [
                "Erro ao analisar o site.",
                "Tente novamente em instantes."
            ],
            fonte: "Erro de Conexão",
            tempoResposta: `${Date.now() - inicio}ms`
        });
    }
});

// 🚀 Inicialização
const PORTA = process.env.PORT || 3000;

app.listen(PORTA, () => {
    console.log(`🚀 Servidor rodando na porta ${PORTA}`);
});
