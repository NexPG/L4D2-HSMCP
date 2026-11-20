# HSMCP Bot Meds

A VScript addon for Left 4 Dead 2. Bots may pick up and carry pain pills and adrenaline, but
they may only **use** them while their total health — permanent plus temporary — is below
**20**. Above that line the addon switches the bot away from the item; the item stays in the
bot's inventory, so the bot can carry it or give it to a teammate.

There is no hidden inventory and nothing is removed or dropped. This is the behaviour the
request asked for: the bot keeps the item, but cannot start the use animation while healthy.

Medkits are not touched. They work exactly as vanilla.

## Behaviour

- Total health is `GetHealth() + GetHealthBuffer()`. Temporary health counts the same as
  permanent health.
- Above 20 HP, when a bot has pills or adrenaline in hand, the poller calls
  `SwitchToItem` on another carried weapon (or the pistol). The pill/adrenaline entity remains
  in the inventory.
- Below 20 HP the addon does nothing; the bot is free to use the item.
- The bot can still give the item to a teammate; the addon only prevents self-use above the
  threshold. (A give action that keeps the item in hand may be interrupted by the switch; this
  is the limitation of a VScript-only approach.)
- The addon runs from `mapspawn_addon.nut` and a `logic_script` `thinkfunction` every 0.1 s.
- Logs are prefixed `[HSMCP_BOT_MEDS]` in `console.log` under `-condebug`.

## Install

```
left4dead2/addons/hsmcp_bot_meds.vpk
```

or unpack the folder as `left4dead2/addons/hsmcp-bot-meds/`. Keep only one form.

## Tuning

`scripts/vscripts/hsmcp_bot_meds.nut`:

```
HSMCP_BOT_MEDS_THRESHOLD <- 20.0;   // total health below which use is allowed
HSMCP_BOT_MEDS_DEBUG <- true;       // print lock lines
```

## Verified

On `c1m1_hotel`, with medkits used first:

- three bots at 30 HP with pills: `locked weapon_pain_pills ... switched to weapon_pistol`;
- after the lock, `carried weapon_pain_pills=3` — the items are still in the inventories;
- at 10 HP: no lock lines, and the items are still carried;
- the bots never fired `pills_used` while above 20 HP.

This is a carry lock, not a hidden inventory: the item is never taken away.
