require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

// 1. CONFIGURAÇÃO DA OPENAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// 2. O NOSSO CACHE
const cachePrivacidade = {};

app.get('/analisar', async (req, res) => {
    const site = req.query.site; 
    console.log(`\n🔍 Extensão pediu análise do site: ${site}`);

    if (cachePrivacidade[site]) {
        console.log(`⚡ [CACHE HIT] Retornando do Cache: ${site}`);
        return res.status(200).json(cachePrivacidade[site]);
    }

    try {
        let dadosParaIA = "";
        let fonteUtilizada = ""; // 👇 1. Criamos a variável para guardar a fonte

        console.log(`🌐 Buscando no banco de dados do ToS;DR...`);
        const tosdrResponse = await fetch(`https://api.tosdr.org/search/v4/?query=${site}`);
        const tosdrData = await tosdrResponse.json();

        if (tosdrData.parameters && tosdrData.parameters.services && tosdrData.parameters.services.length > 0) {
            const servico = tosdrData.parameters.services[0];
            const notaTosdr = servico.rating ? servico.rating.letter : 'Desconhecida';
            
            console.log(`✅ Achou no ToS;DR! Serviço pescado: "${servico.name}" | Nota deles: ${notaTosdr}`);
            
            // 👇 2. Se achou no banco, salvamos essa fonte!
            fonteUtilizada = "Base de dados ToS;DR + Inteligência Artificial";

            dadosParaIA = `O site ${site} possui a Nota ${notaTosdr} no ToS;DR.
            Aqui estão os dados brutos encontrados: ${JSON.stringify(servico)}.
            Traduza para português, ignore informações irrelevantes e extraia os piores pontos para o usuário.`;
        } else {
            console.log(`⚠️ Site não está no ToS;DR. A IA fará a análise com base no seu conhecimento prévio.`);
            
            // 👇 3. Se não achou, salvamos que foi só a IA!
            fonteUtilizada = "Exclusiva por Inteligência Artificial (Sem registros no ToS;DR)";

            dadosParaIA = `Não há dados no ToS;DR. Faça uma análise baseada no seu conhecimento sobre o site ${site}.`;
        }

        console.log(`⏳ Consultando o GPT-4o-mini...`);
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
                    1. "score": Analise os dados brutos e calcule VOCÊ MESMO uma nota rigorosa ('A', 'B', 'C', 'D' ou '?'). Ignore a nota original do ToS;DR, confie na sua própria análise de gravidade dos dados encontrados.
                    2. "alertas": Uma lista contendo exatamente 3 pontos críticos em Português do Brasil. Seja objetivo! (ex: "Compartilha seus dados com parceiros de marketing").`
                },
                {
                    role: "user",
                    content: `Base de dados para análise:\n${dadosParaIA}\n\nRetorne estritamente o JSON: {"score": "Nota", "alertas": ["Alerta 1", "Alerta 2", "Alerta 3"]}`
                }
            ]
        });

        const dadosFormatados = JSON.parse(resposta.choices[0].message.content);

        // 👇 4. Injetamos a fonte no objeto que vai para a extensão!
        dadosFormatados.fonte = fonteUtilizada;

        cachePrivacidade[site] = dadosFormatados;
        console.log(`💾 [SALVO NO CACHE] Score: ${dadosFormatados.score}. Pronto para os próximos acessos!`);
        
        res.status(200).json(dadosFormatados);

    } catch (erro) {
        console.error("❌ Erro no backend:", erro);
        res.status(200).json({
            score: "?",
            alertas: [
                "Houve uma falha ao consultar nossas bases de dados.",
                "Por favor, tente fechar e abrir este aviso novamente."
            ],
            fonte: "Erro de Conexão" // Adicionamos a fonte pro caso de erro também
        });
    }
});

const PORTA = 3000;
app.listen(PORTA, () => {
    console.log(`🚀 Servidor Turbinado (Cache + ToS;DR + OpenAI) rodando na porta ${PORTA}!`);
});