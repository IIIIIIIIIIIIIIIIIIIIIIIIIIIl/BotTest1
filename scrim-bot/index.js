// ================== SETUP ==================
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  PermissionsBitField,
  EmbedBuilder
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// In-memory storage (replace with DB later)
const matches = {};
const playerStats = {}; // { userId: { matches: [] } }

// ================== READY ==================
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ================== COMMANDS ==================
const commands = [
  new SlashCommandBuilder()
    .setName('host')
    .setDescription('Host a match')
    .addStringOption(option =>
      option.setName('amount')
        .setDescription('Team size')
        .setRequired(true)
        .addChoices(
          { name: '3v3', value: '3' },
          { name: '4v4', value: '4' },
          { name: '5v5', value: '5' },
          { name: '6v6', value: '6' },
          { name: '7v7', value: '7' },
          { name: '8v8', value: '8' },
          { name: '9v9', value: '9' }
        )
    ),

  new SlashCommandBuilder()
    .setName('matches')
    .setDescription('Check player matches')
    .addUserOption(option =>
      option.setName('player')
        .setDescription('Player')
        .setRequired(true)
    )
];

// ================== INTERACTIONS ==================
client.on('interactionCreate', async (interaction) => {

  // ===== HOST COMMAND =====
  if (interaction.isChatInputCommand() && interaction.commandName === 'host') {
    const size = parseInt(interaction.options.getString('amount'));

    const embed = new EmbedBuilder()
      .setTitle(`${size}v${size} War`)
      .setDescription('Click join to participate')
      .addFields(
        { name: 'Team 1', value: 'Empty', inline: true },
        { name: 'Team 2', value: 'Empty', inline: true },
        { name: 'Subs', value: 'None' }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('join').setLabel('Join').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('leave').setLabel('Leave').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('end').setLabel('End Match').setStyle(ButtonStyle.Primary)
    );

    const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

    matches[msg.id] = {
      host: interaction.user.id,
      size,
      team1: [],
      team2: [],
      subs: [],
      finished: false
    };
  }

  // ===== MATCHES COMMAND =====
  if (interaction.isChatInputCommand() && interaction.commandName === 'matches') {
    const user = interaction.options.getUser('player');
    const data = playerStats[user.id];

    if (!data || data.matches.length === 0) {
      return interaction.reply(`${user.username} has no matches.`);
    }

    const text = data.matches.map(m => `• ${m}`).join('\n');
    interaction.reply(`Matches for ${user.username}:\n${text}`);
  }

  // ===== BUTTONS =====
  if (interaction.isButton()) {
    const match = matches[interaction.message.id];
    if (!match) return;

    // JOIN
    if (interaction.customId === 'join') {
      const modal = new ModalBuilder()
        .setCustomId('username_modal')
        .setTitle('Roblox Username');

      const input = new TextInputBuilder()
        .setCustomId('username')
        .setLabel('Enter username')
        .setStyle(TextInputStyle.Short);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    // LEAVE
    if (interaction.customId === 'leave') {
      removePlayer(match, interaction.user.id);
      updateEmbed(interaction, match);
      return interaction.reply({ content: 'You left.', ephemeral: true });
    }

    // CANCEL
    if (interaction.customId === 'cancel') {
      if (interaction.user.id !== match.host &&
          !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'Not allowed', ephemeral: true });
      }

      delete matches[interaction.message.id];
      return interaction.update({ content: 'Match cancelled', embeds: [], components: [] });
    }

    // END MATCH
    if (interaction.customId === 'end') {
      if (interaction.user.id !== match.host) {
        return interaction.reply({ content: 'Only host can end.', ephemeral: true });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('team1win').setLabel('Team 1 Won').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('team2win').setLabel('Team 2 Won').setStyle(ButtonStyle.Success)
      );

      return interaction.reply({ content: 'Select winner', components: [row] });
    }

    // WINNER SELECT
    if (interaction.customId === 'team1win' || interaction.customId === 'team2win') {
      const winner = interaction.customId === 'team1win' ? 'Team 1' : 'Team 2';

      match.finished = true;

      const allPlayers = [...match.team1, ...match.team2];
      allPlayers.forEach(p => {
        if (!playerStats[p.id]) playerStats[p.id] = { matches: [] };
        playerStats[p.id].matches.push(`${winner} (${match.size}v${match.size})`);
      });

      return interaction.update({ content: `Winner: ${winner}`, components: [] });
    }
  }

  // ===== MODAL =====
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'username_modal') {
      const match = matches[interaction.message.id];
      const username = interaction.fields.getTextInputValue('username');

      const player = {
        id: interaction.user.id,
        roblox: username,
        host: interaction.user.id === match.host
      };

      if (match.team1.length < match.size) {
        match.team1.push(player);
      } else if (match.team2.length < match.size) {
        match.team2.push(player);
      } else {
        match.subs.push(player);
      }

      updateEmbed(interaction, match);
      interaction.reply({ content: 'Joined!', ephemeral: true });
    }
  }
});

// ================== HELPERS ==================
function removePlayer(match, userId) {
  match.team1 = match.team1.filter(p => p.id !== userId);
  match.team2 = match.team2.filter(p => p.id !== userId);
  match.subs = match.subs.filter(p => p.id !== userId);
}

function formatTeam(team) {
  if (team.length === 0) return 'Empty';
  return team.map(p => `<@${p.id}> - ${p.roblox} | ${p.host ? 'Host' : 'Player'}`).join('\n');
}

function updateEmbed(interaction, match) {
  const embed = new EmbedBuilder()
    .setTitle(`${match.size}v${match.size} War`)
    .addFields(
      { name: 'Team 1', value: formatTeam(match.team1), inline: true },
      { name: 'Team 2', value: formatTeam(match.team2), inline: true },
      { name: 'Subs', value: formatTeam(match.subs) }
    );

  interaction.message.edit({ embeds: [embed] });
}

client.login(process.env.TOKEN);
