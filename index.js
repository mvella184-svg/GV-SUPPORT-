require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags,
  AutoModerationRuleEventType, AutoModerationRuleTriggerType,
  AutoModerationActionType, AutoModerationRuleKeywordPresetType,
} = require('discord.js');

// ---------- Simple JSON storage ----------
// Railway par Volume mount karo (e.g. /data) aur DATA_DIR=/data set karo, warna redeploy par data reset ho jata ha
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_FILE = path.join(DATA_DIR, 'db.json');
let db = {};
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { db = {}; }
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const g = (id) => (db[id] ??= { welcomeChannel: null, supportRole: null, skRole: null, ticketCount: 0 });

// ---------- Client ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,   // Developer Portal me "Server Members Intent" ON karo
    GatewayIntentBits.GuildInvites,
  ],
});

// ---------- Commands ----------
const commands = [
  new SlashCommandBuilder().setName('welcome').setDescription('Welcome system')
    .addSubcommand((s) => s.setName('set').setDescription('Welcome channel set karo')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))),
  new SlashCommandBuilder().setName('ticket').setDescription('Ticket system')
    .addSubcommand((s) => s.setName('setup').setDescription('Ticket panel bhejo')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((s) => s.setName('role').setDescription('Ticket par mention hone wala role')
      .addRoleOption((o) => o.setName('role').setDescription('Support role').setRequired(true))),
  new SlashCommandBuilder().setName('custom').setDescription('Bot se custom message bhejo')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption((o) => o.setName('message').setDescription('Message').setRequired(true)),
  new SlashCommandBuilder().setName('automod').setDescription('Auto moderation')
    .addSubcommand((s) => s.setName('enable').setDescription('Auto mod enable karo')),
  new SlashCommandBuilder().setName('sk').setDescription('Admin access role')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('role').setDescription('Jis role ko bot ke admin commands milein')
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))),
].map((c) => c.toJSON());

// Admin check: Administrator permission ya /sk role wala role
function isAllowed(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const sk = g(member.guild.id).skRole;
  return !!sk && member.roles.cache.has(sk);
}

// ---------- Invite tracking ----------
const invitesCache = new Map(); // guildId -> Map(code -> uses)
async function cacheInvites(guild) {
  try {
    const invs = await guild.invites.fetch();
    invitesCache.set(guild.id, new Map(invs.map((i) => [i.code, i.uses ?? 0])));
  } catch { /* Manage Server permission nahi */ }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity('GVTOWN•SUPPORT');
  await client.application.commands.set(commands);
  for (const guild of client.guilds.cache.values()) await cacheInvites(guild);
});
client.on('guildCreate', cacheInvites);
client.on('inviteCreate', (i) => invitesCache.get(i.guild.id)?.set(i.code, i.uses ?? 0));
client.on('inviteDelete', (i) => invitesCache.get(i.guild.id)?.delete(i.code));

client.on('guildMemberAdd', async (member) => {
  const cfg = g(member.guild.id);
  if (!cfg.welcomeChannel) return;
  const channel = member.guild.channels.cache.get(cfg.welcomeChannel);
  if (!channel) return;

  let inviter = 'Unknown';
  try {
    const before = invitesCache.get(member.guild.id) ?? new Map();
    const now = await member.guild.invites.fetch();
    const used = now.find((i) => (i.uses ?? 0) > (before.get(i.code) ?? 0));
    invitesCache.set(member.guild.id, new Map(now.map((i) => [i.code, i.uses ?? 0])));
    if (used?.inviter) inviter = used.inviter.username;
  } catch { /* ignore */ }

  channel.send({
    content: `WELCOME TO GVTOWN ${member}\nINVITED BY ${inviter}`,
    allowedMentions: { users: [member.id] },
  });
});

// ---------- Interactions ----------
client.on('interactionCreate', async (i) => {
  try {
    if (i.isChatInputCommand()) return await onCommand(i);
    if (i.isButton()) return await onButton(i);
  } catch (e) {
    console.error(e);
    const msg = { content: 'Error aa gaya, dobara try karo.', flags: MessageFlags.Ephemeral };
    if (i.deferred || i.replied) i.followUp(msg).catch(() => {}); else i.reply(msg).catch(() => {});
  }
});

async function onCommand(i) {
  const cfg = g(i.guildId);
  if (!isAllowed(i.member)) {
    return i.reply({ content: '❌ Aap ke paas is command ka access nahi ha.', flags: MessageFlags.Ephemeral });
  }

  if (i.commandName === 'welcome') {
    const ch = i.options.getChannel('channel');
    cfg.welcomeChannel = ch.id; save();
    return i.reply({ content: `✅ Welcome channel set: ${ch}`, flags: MessageFlags.Ephemeral });
  }

  if (i.commandName === 'ticket') {
    if (i.options.getSubcommand() === 'setup') {
      const ch = i.options.getChannel('channel');
      const embed = new EmbedBuilder().setTitle('🎫 Create Ticket')
        .setDescription('Support chahiye? Neeche button dabao, aap ka ticket ban jaye ga.').setColor(0x5865f2);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_create').setLabel('Create Ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary));
      await ch.send({ embeds: [embed], components: [row] });
      return i.reply({ content: `✅ Ticket panel bhej diya: ${ch}`, flags: MessageFlags.Ephemeral });
    }
    const role = i.options.getRole('role');
    cfg.supportRole = role.id; save();
    return i.reply({ content: `✅ Ticket support role set: ${role}`, flags: MessageFlags.Ephemeral });
  }

  if (i.commandName === 'custom') {
    const ch = i.options.getChannel('channel');
    const text = i.options.getString('message').replace(/\\n/g, '\n');
    await ch.send({ content: text });
    return i.reply({ content: `✅ Message bhej diya: ${ch}`, flags: MessageFlags.Ephemeral });
  }

  if (i.commandName === 'automod') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const base = {
      eventType: AutoModerationRuleEventType.MessageSend,
      actions: [{ type: AutoModerationActionType.BlockMessage }],
      enabled: true,
    };
    const rules = [
      { name: 'GVTOWN Profanity/Slurs', triggerType: AutoModerationRuleTriggerType.KeywordPreset,
        triggerMetadata: { presets: [AutoModerationRuleKeywordPresetType.Profanity, AutoModerationRuleKeywordPresetType.SexualContent, AutoModerationRuleKeywordPresetType.Slurs] } },
      { name: 'GVTOWN Spam', triggerType: AutoModerationRuleTriggerType.Spam },
      { name: 'GVTOWN Mention Spam', triggerType: AutoModerationRuleTriggerType.MentionSpam, triggerMetadata: { mentionTotalLimit: 5 } },
    ];
    const existing = await i.guild.autoModerationRules.fetch();
    const results = [];
    for (const r of rules) {
      if (existing.some((e) => e.name === r.name)) { results.push(`✔️ ${r.name} (pehle se on)`); continue; }
      try { await i.guild.autoModerationRules.create({ ...base, ...r }); results.push(`✅ ${r.name}`); }
      catch (e) { results.push(`⚠️ ${r.name}: ${e.message}`); }
    }
    return i.editReply('🛡️ AutoMod enabled:\n' + results.join('\n'));
  }

  if (i.commandName === 'sk') {
    const role = i.options.getRole('role');
    cfg.skRole = role.id; save();
    return i.reply({ content: `✅ Ab sirf ${role} (aur Administrators) bot ke admin commands use kar sakte hain.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
}

async function onButton(i) {
  const cfg = g(i.guildId);

  if (i.customId === 'ticket_create') {
    // Pehle se open ticket check
    const open = i.guild.channels.cache.find((c) => c.topic === `ticket-owner:${i.user.id}`);
    if (open) return i.reply({ content: `❌ Aap ka ticket pehle se open ha: ${open}`, flags: MessageFlags.Ephemeral });

    cfg.ticketCount += 1; save();
    const overwrites = [
      { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
    ];
    if (cfg.supportRole) overwrites.push({ id: cfg.supportRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

    const channel = await i.guild.channels.create({
      name: `ticket-${cfg.ticketCount}`,
      type: ChannelType.GuildText,
      topic: `ticket-owner:${i.user.id}`,
      permissionOverwrites: overwrites,
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger));
    const mention = cfg.supportRole ? `<@&${cfg.supportRole}>` : '';
    await channel.send({
      content: `${i.user} ${mention}`.trim(),
      embeds: [new EmbedBuilder().setTitle('🎫 Ticket').setColor(0x57f287)
        .setDescription('Apna masla likho, support team jald reply kare gi.')],
      components: [row],
      allowedMentions: { users: [i.user.id], roles: cfg.supportRole ? [cfg.supportRole] : [] },
    });
    return i.reply({ content: `✅ Ticket ban gaya: ${channel}`, flags: MessageFlags.Ephemeral });
  }

  if (i.customId === 'ticket_close') {
    const ownerId = i.channel.topic?.replace('ticket-owner:', '');
    if (i.user.id !== ownerId && !isAllowed(i.member) && !(cfg.supportRole && i.member.roles.cache.has(cfg.supportRole))) {
      return i.reply({ content: '❌ Aap ye ticket close nahi kar sakte.', flags: MessageFlags.Ephemeral });
    }
    await i.reply('🔒 Ticket 5 second me close ho raha ha...');
    setTimeout(() => i.channel.delete().catch(() => {}), 5000);
  }
}

client.login(process.env.TOKEN);
