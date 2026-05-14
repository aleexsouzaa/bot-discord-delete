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
  return JSON.parse(fs.readFileSync(CONFIG_FILE));
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
  REST,
  Routes
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('error', (err) => {
  console.error('❌ Erro Discord:', err);
});


let autoDeleteConfig = loadConfig();
let intervals = {};


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
// AUTO DELETE
// =====================
async function startAutoDelete(client, canalId, tempoMs) {
  try {
    const canal = await client.channels.fetch(canalId);
    if (!canal || !canal.isTextBased()) return;

    if (intervals[canalId]) clearInterval(intervals[canalId]);

    console.log(`✅ Auto delete ativo em ${canal.name}`);

    intervals[canalId] = setInterval(async () => {
      try {
        console.log(`🔁 Rodando limpeza em ${canal.name}`);

        const messages = await canal.messages.fetch({ limit: 100 });

        const deletable = messages.filter(
          m => m.deletable && !m.pinned
        );

        if (!deletable.size) return;

        await canal.bulkDelete(deletable, true);

        console.log(`🧹 ${deletable.size} mensagens apagadas em ${canal.name}`);

      } catch (err) {
        console.error("❌ erro loop:", err.message);
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
// COMMANDS
// =====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {

    // ✅ limpar
    if (interaction.commandName === 'limpar') {
      const quantidade = interaction.options.getInteger('quantidade');

      // responde IMEDIATO
      await interaction.reply({
        content: `✅ Apagando ${quantidade} mensagens...`,
        flags: MessageFlags.Ephemeral
      });

      await interaction.channel.bulkDelete(quantidade, true);
      return;
    }


    // ✅ autodelete
    if (interaction.commandName === 'autodelete') {
      const canal = interaction.options.getChannel('canal');
      const tempoStr = interaction.options.getString('tempo');
      const tempoMs = parseTempo(tempoStr);

      if (!tempoMs || tempoMs < 5000) {
        return interaction.reply({
          content: "⚠️ Tempo inválido",
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


    // ✅ stop
    if (interaction.commandName === 'stopautodelete') {

      for (const id in intervals) {
        clearInterval(intervals[id]);
      }

      intervals = {};
      autoDeleteConfig = {};
      saveConfig(autoDeleteConfig);

      return interaction.reply({
        content: "🛑 Auto delete parado",
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

          msg += `• #${canal.name} → ${formatTempo(tempo)}\n`;

        } catch {
          msg += `• canal inválido\n`;
        }
      }

      return interaction.editReply(msg);
    }

  } catch (err) {
    console.error("❌ erro comando:", err);

    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ erro interno",
        flags: MessageFlags.Ephemeral
      });
    }
  }
});


// =====================
// REGISTER
// =====================
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    {
      body: [
        new SlashCommandBuilder()
          .setName('limpar')
          .setDescription('Apagar mensagens')
          .addIntegerOption(o =>
            o.setName('quantidade')
              .setDescription('1 a 100')
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
          .setDescription('Parar auto delete'),

        new SlashCommandBuilder()
          .setName('status')
          .setDescription('Ver status')
      ]
    }
  );

  console.log("✅ Slash registrados");
})();

client.login(TOKEN);
