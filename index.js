const fs = require('fs');

const CONFIG_FILE = './autodelete.json';

// carregar config
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_FILE));
}

// salvar config
function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// =====================
// EXPRESS (Render fix)
// =====================
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot rodando ✅');
});

app.listen(3000, () => {
  console.log('🌐 Servidor web ativo (Render feliz)');
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
// ⏱️ CONVERSOR DE TEMPO
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


// =====================
// READY
// =====================
client.once('clientReady', async () => {
  const config = loadConfig();

  for (const canalId in config) {
    console.log(`🔄 Restaurando auto delete para canal ${canalId}`);
    await startAutoDelete(client, canalId, config[canalId]);
  }
  console.log(`✅ Bot online: ${client.user.tag}`);
});


// =====================
// 💬 COMANDOS TEXTO
// =====================
client.on('messageCreate', async (message) => {

  if (message.author.bot) return;

  // ✅ !limpar
  if (message.content.startsWith('!limpar')) {

    const quantidade = parseInt(message.content.split(' ')[1]);

    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return message.reply('❌ Sem permissão');
    }

    if (!quantidade || quantidade < 1 || quantidade > 100) {
      return message.reply('Use: !limpar 1-100');
    }

    await message.channel.bulkDelete(quantidade, true);
    const msg = await message.channel.send(`✅ ${quantidade} mensagens apagadas`);
    setTimeout(() => msg.delete(), 3000);
  }

  // ✅ !autodelete
  if (message.content.startsWith('!autodelete')) {

    const args = message.content.split(' ');
    const canal = message.mentions.channels.first();
    const tempo = args[2];

    if (!canal || !tempo) {
      return message.reply('Uso: !autodelete #canal 10s / 1m / 1h');
    }

    const tempoMs = parseTempo(tempo);

    if (!tempoMs || tempoMs < 5000) {
      return message.reply('⚠️ Tempo mínimo: 5s');
    }

    if (autoDeleteConfig[canal.id]) {
      clearInterval(autoDeleteConfig[canal.id]);
    }

    autoDeleteConfig[canal.id] = setInterval(async () => {
      try {
        await canal.bulkDelete(100, true);
        console.log(`🧹 Limpando ${canal.name}`);
      } catch (err) {
        console.error(err);
      }
    }, tempoMs);

    message.reply(`✅ Auto delete ativado em ${canal.name} (${tempo})`);
  }

  // ✅ !parar
  if (message.content === '!parar') {

    Object.keys(autoDeleteConfig).forEach(id => {
      clearInterval(autoDeleteConfig[id]);
    });

    autoDeleteConfig = {};
    message.reply('🛑 Auto delete parado');
  }

});


// =====================
// ⚡ SLASH COMMANDS
// =====================
client.on('interactionCreate', async (interaction) => {

  if (!interaction.isChatInputCommand()) return;

  // ✅ /limpar
  if (interaction.commandName === 'limpar') {

    const quantidade = interaction.options.getInteger('quantidade');

    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return interaction.reply({ content: '❌ Sem permissão', ephemeral: true });
    }

    await interaction.channel.bulkDelete(quantidade, true);
    return interaction.reply(`✅ ${quantidade} mensagens apagadas`);
  }

  // ✅ /autodelete (NOVO)
if (interaction.commandName === 'autodelete') {

  const canal = interaction.options.getChannel('canal');
  const tempoStr = interaction.options.getString('tempo');

  const tempoMs = parseTempo(tempoStr);

  if (!tempoMs || tempoMs < 5000) {
    return interaction.reply("⚠️ Tempo inválido");
  }

  autoDeleteConfig[canal.id] = tempoMs;
  saveConfig(autoDeleteConfig);

  await startAutoDelete(client, canal.id, tempoMs);

  return interaction.reply(`✅ Auto delete ativado em ${canal.name} (${tempoStr})`);
}

  // ✅ /stopautodelete
 if (interaction.commandName === 'stopautodelete') {

  for (const canalId in intervals) {
    clearInterval(intervals[canalId]);
  }

  intervals = {};
  autoDeleteConfig = {};
  saveConfig(autoDeleteConfig);

  return interaction.reply('🛑 Auto delete parado e apagado da config');
}


// =====================
// 📦 REGISTRAR SLASH
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
            .addIntegerOption(opt =>
              opt.setName('quantidade')
                .setDescription('1-100')
                .setRequired(true)
            ),

          new SlashCommandBuilder()
            .setName('autodelete')
            .setDescription('Ativar auto delete')
            .addChannelOption(opt =>
              opt.setName('canal')
                .setDescription('Canal')
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt.setName('tempo')
                .setDescription('10s, 5m, 1h, 1h30m')
                .setRequired(true)
            ),

          new SlashCommandBuilder()
            .setName('stopautodelete')
            .setDescription('Parar auto delete')

        ]
      }
    );

    console.log('✅ Slash commands registrados');
  } catch (err) {
    console.error(err);
  }
})();


async function startAutoDelete(client, canalId, tempoMs) {
  const canal = await client.channels.fetch(canalId);

  if (!canal) return;

  if (intervals[canalId]) {
    clearInterval(intervals[canalId]);
  }

  intervals[canalId] = setInterval(async () => {
    try {
      await canal.bulkDelete(100, true);
      console.log(`🧹 Limpando ${canal.name}`);
    } catch (err) {
      console.error(err);
    }
  }, tempoMs);
}

client.login(TOKEN);