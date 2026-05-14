// =====================
// CONFIG FILE
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

app.get('/', (req, res) => {
  res.send('Bot rodando ✅');
});

app.listen(3000, () => {
  console.log('🌐 Servidor web ativo');
});


// =====================
// DISCORD
// =====================
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  SlashCommandBuilder,
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

let autoDeleteConfig = loadConfig();
let intervals = {};


// =====================
// ⏱️ TEMPO
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
  const segundos = Math.floor(ms / 1000);

  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;

  let result = "";

  if (h) result += `${h}h `;
  if (m) result += `${m}m `;
  if (s) result += `${s}s`;

  return result.trim();
}


// =====================
// ✅ AUTO DELETE
// =====================
async function startAutoDelete(client, canalId, tempoMs) {
  try {
    const canal = await client.channels.fetch(canalId);

    if (!canal) {
      console.log(`❌ Canal não encontrado`);
      return;
    }

    if (intervals[canalId]) {
      clearInterval(intervals[canalId]);
    }

    console.log(`✅ Auto delete ativo em ${canal.name}`);

    intervals[canalId] = setInterval(async () => {
      try {
        const messages = await canal.messages.fetch({ limit: 100 });

        if (!messages.size) return;

        await canal.bulkDelete(messages, true);

        console.log(`🧹 Limpou ${messages.size} mensagens em ${canal.name}`);
      } catch (err) {
        console.error("Erro ao limpar:", err);
      }
    }, tempoMs);

  } catch (err) {
    console.error("Erro ao iniciar:", err);
  }
}


// =====================
// READY + RESTORE
// =====================
client.once('clientReady', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);

  const config = loadConfig();

  for (const canalId in config) {
    try {
      await startAutoDelete(client, canalId, config[canalId]);
      console.log(`🔄 Restaurado canal ${canalId}`);
    } catch (err) {
      console.error("Erro restore:", err);
    }
  }
});


// =====================
// ✅ SLASH COMMANDS
// =====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // limpar
  if (interaction.commandName === 'limpar') {
    const quantidade = interaction.options.getInteger('quantidade');

    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return interaction.reply({ content: "Sem permissão", ephemeral: true });
    }

    await interaction.channel.bulkDelete(quantidade, true);
    return interaction.reply(`✅ ${quantidade} apagadas`);
  }

  // autodelete
  if (interaction.commandName === 'autodelete') {
    const canal = interaction.options.getChannel('canal');
    const tempoStr = interaction.options.getString('tempo');

    const tempoMs = parseTempo(tempoStr);

    if (!tempoMs || tempoMs < 5000) {
      return interaction.reply("Tempo inválido");
    }

    autoDeleteConfig[canal.id] = tempoMs;
    saveConfig(autoDeleteConfig);

    await startAutoDelete(client, canal.id, tempoMs);

    return interaction.reply(`✅ Auto delete ativado em ${canal.name}`);
  }

  // stop
  if (interaction.commandName === 'stopautodelete') {
    for (const id in intervals) {
      clearInterval(intervals[id]);
    }

    intervals = {};
    autoDeleteConfig = {};
    saveConfig(autoDeleteConfig);

    return interaction.reply("🛑 Auto delete parado");
  }

  // ✅ status
  if (interaction.commandName === 'status') {

    if (!Object.keys(autoDeleteConfig).length) {
      return interaction.reply("⚠️ Nenhum canal com auto delete ativo");
    }

    let msg = "📊 Auto Delete Ativo:\n\n";

    for (const canalId in autoDeleteConfig) {
      try {
        const canal = await client.channels.fetch(canalId);
        const tempo = autoDeleteConfig[canalId];

        msg += `• ${canal.name} → a cada ${formatTempo(tempo)}\n`;

      } catch (err) {
        msg += `• Canal desconhecido (${canalId})\n`;
      }
    }

    return interaction.reply(msg);
  }
});


// =====================
// ✅ REGISTRAR SLASH
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
          .addIntegerOption(opt =>
            opt.setName('quantidade').setRequired(true)
          ),

        new SlashCommandBuilder()
          .setName('autodelete')
          .setDescription('Auto delete')
          .addChannelOption(opt =>
            opt.setName('canal').setRequired(true)
          )
          .addStringOption(opt =>
            opt.setName('tempo').setRequired(true)
          ),

        new SlashCommandBuilder()
          .setName('stopautodelete')
          .setDescription('Parar auto delete'),

        
        new SlashCommandBuilder()
          .setName('status')
          .setDescription('Ver canais com auto delete ativo')

      ]
    }
  );

  console.log("✅ Slash registrados");
})();


client.login(TOKEN);
