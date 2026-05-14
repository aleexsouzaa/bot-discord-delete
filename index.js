
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

let autoDeleteConfig = {};

// =====================
// CONVERSOR DE TEMPO
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

client.once('clientReady', () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
});


// =====================
// COMANDOS DE TEXTO
// =====================
client.on('messageCreate', async (message) => {

  if (message.author.bot) return;

  // limpar manual
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

  // AUTO DELETE
  if (message.content.startsWith('!autodelete')) {

    const args = message.content.split(' ');
    const canal = message.mentions.channels.first();
    const tempo = args[2];

    if (!canal || !tempo) {
      return message.reply('Uso: !autodelete #canal 1h30m');
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
        console.log(`🧹 Limpou ${canal.name}`);
      } catch (err) {
        console.error(err);
      }
    }, tempoMs);

    message.reply(`✅ Auto delete ativado em ${canal.name} (${tempo})`);
  }

  // parar auto delete
  if (message.content === '!parar') {

    Object.keys(autoDeleteConfig).forEach(id => {
      clearInterval(autoDeleteConfig[id]);
    });

    autoDeleteConfig = {};
    message.reply('🛑 Auto delete parado');
  }

});


// =====================
// SLASH COMMANDS
// =====================
client.on('interactionCreate', async (interaction) => {

  if (!interaction.isChatInputCommand()) return;

  // /limpar
  if (interaction.commandName === 'limpar') {

    const quantidade = interaction.options.getInteger('quantidade');

    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return interaction.reply({ content: '❌ Sem permissão', ephemeral: true });
    }

    await interaction.channel.bulkDelete(quantidade, true);
    interaction.reply(`✅ ${quantidade} mensagens apagadas`);
  }

  // /stopautodelete
  if (interaction.commandName === 'stopautodelete') {

    Object.keys(autoDeleteConfig).forEach(id => {
      clearInterval(autoDeleteConfig[id]);
    });

    autoDeleteConfig = {};
    interaction.reply('🛑 Auto delete parado em todos canais');
  }

});


// =====================
// REGISTRAR SLASH
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


client.login(TOKEN);
``