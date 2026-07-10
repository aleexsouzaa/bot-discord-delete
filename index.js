// =====================
// PROTEÇÃO GLOBAL
// =====================
process.on('unhandledRejection', (err) => {
  console.error('❌ unhandledRejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException:', err);
});


// =====================
// CONFIG
// =====================
const fs = require('fs');
const CONFIG_FILE = './autodelete.json';

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE));
  } catch (err) {
    // Se o arquivo existir mas estiver corrompido (ex: processo derrubado
    // no meio de um writeFileSync), não deixa o bot inteiro morrer no
    // boot - só loga e começa com config vazia.
    console.error('❌ Erro ao ler autodelete.json, iniciando com config vazia:', err.message);
    return {};
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}


// =====================
// EXPRESS (Render)
// =====================
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Bot rodando ✅'));
app.listen(3000, () => console.log('🌐 Servidor ativo'));


// =====================
// DISCORD
// =====================
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  MessageFlags,
  PermissionsBitField,
  REST,
  Routes
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ TOKEN e/ou CLIENT_ID não configurados nas variáveis de ambiente. Encerrando.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
    // MessageContent removido: não é necessário para apagar mensagens
    // (bulkDelete/delete não dependem do conteúdo) - é um intent
    // privilegiado que exige aprovação manual da Discord quando o bot
    // passa de 100 servidores, então evitar pedir o que não se usa
    // reduz atrito de verificação no futuro.
  ]
});

client.on('error', (err) => {
  console.error('❌ Erro Discord:', err);
});


let autoDeleteConfig = loadConfig();
let intervals = {};

// Contador de falhas consecutivas por canal - usado para desligar
// automaticamente um auto-delete que está falhando sempre (canal
// apagado, permissão revogada, etc.), em vez de ficar rodando pra
// sempre gerando erro no console sem que ninguém perceba.
let falhasConsecutivas = {};
const LIMITE_FALHAS_CONSECUTIVAS = 5;

// Tempo até a confirmação efêmera do /limpar se apagar sozinha.
const TEMPO_AUTO_DISMISS_MS = 30000;


// =====================
// TEMPO
// =====================
function parseTempo(str) {
  let total = 0;
  const regex = /(\d+)(h|m|s)/g;
  let match;

  while ((match = regex.exec(str)) !== null) {
    const valor = parseInt(match[1]);
    const tipo = match[2];

    if (tipo === 'h') total += valor * 3600000;
    if (tipo === 'm') total += valor * 60000;
    if (tipo === 's') total += valor * 1000;
  }

  return total;
}

function formatTempo(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  let r = "";
  if (h) r += `${h}h `;
  if (m) r += `${m}m `;
  if (sec) r += `${sec}s`;
  return r.trim();
}


// =====================
// PERMISSÕES
// =====================
function temPermissaoParaApagar(canal) {
  const me = canal.guild.members.me;
  if (!me) return false;
  const perms = canal.permissionsFor(me);
  return !!perms && perms.has(PermissionsBitField.Flags.ManageMessages);
}


// =====================
// AUTO DELETE
// =====================
function pararAutoDelete(canalId) {
  if (intervals[canalId]) {
    clearInterval(intervals[canalId]);
    delete intervals[canalId];
  }
  delete autoDeleteConfig[canalId];
  delete falhasConsecutivas[canalId];
  saveConfig(autoDeleteConfig);
}

async function startAutoDelete(client, canalId, tempoMs) {
  try {
    const canal = await client.channels.fetch(canalId);
    if (!canal || !canal.isTextBased()) {
      console.error(`❌ Canal ${canalId} inválido ou não é de texto - removendo da config.`);
      pararAutoDelete(canalId);
      return;
    }

    if (!temPermissaoParaApagar(canal)) {
      // Sem permissão ManageMessages, o loop rodaria pra sempre sem
      // apagar nada (o filtro .deletable já barra), silenciosamente.
      // Melhor avisar de cara e não nem ligar o intervalo.
      console.error(`❌ Sem permissão "Gerenciar Mensagens" em #${canal.name} - auto delete não iniciado.`);
      return;
    }

    if (intervals[canalId]) clearInterval(intervals[canalId]);
    falhasConsecutivas[canalId] = 0;

    console.log(`✅ Auto delete ativo em ${canal.name}`);

    intervals[canalId] = setInterval(async () => {
      try {
        console.log(`🔁 Rodando limpeza em ${canal.name}`);

        const messages = await canal.messages.fetch({ limit: 100 });

        const deletable = messages.filter(
          m => m.bulkDeletable && !m.pinned
        );

        if (!deletable.size) {
          falhasConsecutivas[canalId] = 0;
          return;
        }

        await canal.bulkDelete(deletable, true);

        console.log(`🧹 ${deletable.size} mensagens apagadas em ${canal.name}`);
        falhasConsecutivas[canalId] = 0;

      } catch (err) {
        console.error(`❌ erro loop (${canal.name}):`, err.message);

        // Canal apagado (10003) ou permissão revogada (50013) - não
        // adianta continuar tentando pra sempre. Desliga esse canal
        // especificamente após algumas falhas seguidas.
        const codigosFatais = [10003, 50013, 50001];
        falhasConsecutivas[canalId] = (falhasConsecutivas[canalId] || 0) + 1;

        if (codigosFatais.includes(err.code) || falhasConsecutivas[canalId] >= LIMITE_FALHAS_CONSECUTIVAS) {
          console.error(`🛑 Desligando auto delete em ${canal.name} após falhas consecutivas.`);
          pararAutoDelete(canalId);
        }
      }
    }, tempoMs);

  } catch (err) {
    console.error("❌ erro start:", err.message);
  }
}


// =====================
// READY
// =====================
client.once('clientReady', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);

  const config = loadConfig();
  for (const canalId in config) {
    await startAutoDelete(client, canalId, config[canalId]);
  }
});


// =====================
// HELPER DE RESPOSTA SEGURA A ERRO
// =====================
async function responderErro(interaction, mensagem = "❌ erro interno") {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: mensagem, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: mensagem, flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    // Se nem o followUp conseguir ser enviado (ex: interação expirou
    // após 15min), só loga - não há mais nada a fazer.
    console.error("❌ Não foi possível responder erro ao usuário:", err.message);
  }
}


// =====================
// COMMANDS
// =====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {

    // ✅ limpar
    if (interaction.commandName === 'limpar') {
      const quantidade = interaction.options.getInteger('quantidade');

      if (!temPermissaoParaApagar(interaction.channel)) {
        return interaction.reply({
          content: "⚠️ Não tenho permissão \"Gerenciar Mensagens\" neste canal.",
          flags: MessageFlags.Ephemeral
        });
      }

      // responde IMEDIATO
      await interaction.reply({
        content: `✅ Apagando ${quantidade} mensagens...`,
        flags: MessageFlags.Ephemeral
      });

      try {
        const deletadas = await interaction.channel.bulkDelete(quantidade, true);
        await interaction.editReply({
          content: `🧹 ${deletadas.size} mensagens apagadas (mensagens com mais de 14 dias não podem ser apagadas em massa pela API do Discord e são ignoradas).`
        });
      } catch (err) {
        console.error("❌ erro bulkDelete /limpar:", err.message);
        await responderErro(interaction, "❌ Não foi possível apagar as mensagens. Verifique se todas têm menos de 14 dias.");
      }

      // Apaga a própria confirmação efêmera depois de alguns segundos,
      // em vez de deixá-la parada no canal até o usuário clicar em
      // "Ignorar mensagem" manualmente. deleteReply() funciona em
      // respostas efêmeras normalmente - o catch é só para o caso raro
      // do token da interação já ter expirado (>15min) nesse meio tempo.
      setTimeout(() => {
        interaction.deleteReply().catch(() => {});
      }, TEMPO_AUTO_DISMISS_MS);

      return;
    }


    // ✅ autodelete
    if (interaction.commandName === 'autodelete') {
      const canal = interaction.options.getChannel('canal');
      const tempoStr = interaction.options.getString('tempo');
      const tempoMs = parseTempo(tempoStr);

      if (!tempoMs || tempoMs < 5000) {
        return interaction.reply({
          content: "⚠️ Tempo inválido (mínimo 5s). Use o formato: 10s, 5m, 1h",
          flags: MessageFlags.Ephemeral
        });
      }

      if (!canal.isTextBased()) {
        return interaction.reply({
          content: "⚠️ Selecione um canal de texto.",
          flags: MessageFlags.Ephemeral
        });
      }

      if (!temPermissaoParaApagar(canal)) {
        return interaction.reply({
          content: `⚠️ Não tenho permissão "Gerenciar Mensagens" em #${canal.name}.`,
          flags: MessageFlags.Ephemeral
        });
      }

      autoDeleteConfig[canal.id] = tempoMs;
      saveConfig(autoDeleteConfig);

      await startAutoDelete(client, canal.id, tempoMs);

      return interaction.reply({
        content: `✅ Auto delete em #${canal.name} (${formatTempo(tempoMs)})`,
        flags: MessageFlags.Ephemeral
      });
    }


    // ✅ stop (agora por canal, ou todos se nenhum for informado)
    if (interaction.commandName === 'stopautodelete') {
      const canal = interaction.options.getChannel('canal');

      if (canal) {
        if (!autoDeleteConfig[canal.id]) {
          return interaction.reply({
            content: `⚠️ Não há auto delete ativo em #${canal.name}.`,
            flags: MessageFlags.Ephemeral
          });
        }
        pararAutoDelete(canal.id);
        return interaction.reply({
          content: `🛑 Auto delete parado em #${canal.name}`,
          flags: MessageFlags.Ephemeral
        });
      }

      const canaisAtivos = Object.keys(autoDeleteConfig);
      for (const id of canaisAtivos) pararAutoDelete(id);

      return interaction.reply({
        content: canaisAtivos.length
          ? `🛑 Auto delete parado em ${canaisAtivos.length} canal(is).`
          : "⚠️ Nenhum canal com auto delete ativo.",
        flags: MessageFlags.Ephemeral
      });
    }


    // ✅ status (RESPONDE IMEDIATO — NÃO usa defer)
    if (interaction.commandName === 'status') {

      await interaction.reply({
        content: "🔄 Carregando status...",
        flags: MessageFlags.Ephemeral
      });

      const canais = Object.keys(autoDeleteConfig);

      if (!canais.length) {
        return interaction.editReply("⚠️ Nenhum canal ativo");
      }

      let msg = "📊 Status Auto Delete\n\n";

      for (const canalId of canais) {
        try {
          const canal = await client.channels.fetch(canalId);
          const tempo = autoDeleteConfig[canalId];
          const falhas = falhasConsecutivas[canalId] || 0;
          const alerta = falhas > 0 ? ` ⚠️ (${falhas} falha(s) recente(s))` : '';

          msg += `• #${canal.name} → ${formatTempo(tempo)}${alerta}\n`;

        } catch {
          msg += `• canal inválido (${canalId})\n`;
        }
      }

      return interaction.editReply(msg);
    }

  } catch (err) {
    console.error("❌ erro comando:", err);
    await responderErro(interaction);
  }
});


// =====================
// REGISTER
// =====================
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: [
          new SlashCommandBuilder()
            .setName('limpar')
            .setDescription('Apagar mensagens')
            .addIntegerOption(o =>
              o.setName('quantidade')
                .setDescription('2 a 100')
                .setMinValue(2)
                .setMaxValue(100)
                .setRequired(true)
            ),

          new SlashCommandBuilder()
            .setName('autodelete')
            .setDescription('Ativar auto delete')
            .addChannelOption(o =>
              o.setName('canal')
                .setDescription('Canal')
                .setRequired(true)
            )
            .addStringOption(o =>
              o.setName('tempo')
                .setDescription('10s, 5m, 1h')
                .setRequired(true)
            ),

          new SlashCommandBuilder()
            .setName('stopautodelete')
            .setDescription('Parar auto delete')
            .addChannelOption(o =>
              o.setName('canal')
                .setDescription('Canal específico (deixe vazio para parar todos)')
                .setRequired(false)
            ),

          new SlashCommandBuilder()
            .setName('status')
            .setDescription('Ver status')
        ]
      }
    );

    console.log("✅ Slash registrados");
  } catch (err) {
    console.error("❌ Erro ao registrar slash commands:", err);
  }
})();

client.login(TOKEN);