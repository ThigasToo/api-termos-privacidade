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
    message: { error: "Muitas requisições. Tente novamente em 1 minuto." }
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

            fonteUtilizada = "Base de dados ToS;DR + Inteligência Artificial";
            dadosParaIA = `O site ${site} possui a Nota ${notaExclusivaTosdr} no ToS;DR.
            Dados brutos: ${JSON.stringify(servico)}`;

        } else {
            console.log(`⚠️ Sem dados no ToS;DR`);

            fonteUtilizada = "Exclusiva por Inteligência Artificial";
            dadosParaIA = `Não há dados no ToS;DR para o site ${site}. Analise com base no seu conhecimento sobre os termos de privacidade dessa empresa.`;
        }

        console.log(`⏳ Consultando IA...`);

        const resposta = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `Você é um advogado especialista em cibersegurança e privacidade de dados.
Sua missão é gerar um resumo simples e direto para o usuário final.
Sua resposta DEVE ser OBRIGATORIAMENTE um objeto JSON válido.

Regras de análise:
1. "score": Retorne EXATAMENTE a nota do ToS;DR informada na base. Não calcule ou invente uma nova nota de forma alguma. Se a nota não for fornecida ou não existir, retorne "?".
2. "alertas": Uma lista contendo exatamente 3 a 6 pontos críticos em Português do Brasil. Seja objetivo! (ex: "Compartilha seus dados com parceiros de marketing").`
                },
                {
                    role: "user",
                    content: `Base de dados para análise:\n${dadosParaIA}\n\nRetorne estritamente o JSON: {"score": "Nota", "alertas": ["Alerta 1", "Alerta 2", "Alerta 3"]}`
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
                "Erro interno ao analisar o site.",
                "Tente novamente em instantes."
            ],
            fonte: "Erro no Servidor",
            tempoResposta: `${Date.now() - inicio}ms`
        });
    }
});

// 🚀 Inicialização
const PORTA = process.env.PORT || 3000;

app.listen(PORTA, () => {
    console.log(`🚀 Servidor rodando na porta ${PORTA}`);
});
