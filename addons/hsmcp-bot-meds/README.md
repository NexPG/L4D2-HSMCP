# HSMCP Bot Meds

A VScript addon for Left 4 Dead 2. Bots may pick up pain pills and adrenaline, but they only
use them when their **total health** — permanent plus temporary — is below **20**. While they
are above that line and take the item in hand, it is moved into a one-slot hidden inventory
instead of being consumed. When their health falls below 20, the stored item is returned so the
bot can use it.

Medkits are **not** touched by default: bots use them exactly as vanilla does. The code has a
dormant `HSMCP_BOT_MEDS_MEDKITS` switch with the same rule, but it is off because the request
was about pills and adrenaline.

## Behaviour

- Total health is `GetHealth() + GetHealthBuffer()`. Temporary health counts the same as
  permanent health, as requested.
- One hidden slot per bot per category. A bot with a stored pill cannot keep a second
  pill/adrenaline; the extra is put back into the world for a human.
- A stored item is returned when the bot drops below 20 HP, so the bot can use it.
- On death or round end the stored item is dropped at the bot's last position. On a chapter
  transition it is returned to the bot so it travels with the team.
- The addon runs from `mapspawn_addon.nut` and a `logic_script` `thinkfunction`. Event hooks
  live in the file the `logic_script` loads; hooks in a mapspawn include do not register.
- Logs are prefixed `[HSMCP_BOT_MEDS]` in `console.log` under `-condebug`.

## Install

```
left4dead2/addons/hsmcp_bot_meds.vpk
```

or unpack the folder as `left4dead2/addons/hsmcp-bot-meds/`. Only one form should be present.

## Tuning

`scripts/vscripts/hsmcp_bot_meds.nut`:

```
HSMCP_BOT_MEDS_THRESHOLD <- 20.0;   // total health below which use is allowed
HSMCP_BOT_MEDS_MEDKITS <- false;    // also gate first aid kits
HSMCP_BOT_MEDS_DEBUG <- true;       // print store/return/drop lines
```

## Verified

On `c1m1_hotel`, with medkits stripped after bots used them:

- bots at 30 HP with pills: three `stored weapon_pain_pills` lines;
- bots at 10 HP: three `returned weapon_pain_pills` lines;
- temporary health test: 15 HP + 10 buffer (25 total) stored, 10 HP + 5 buffer returned;
- a second item while the slot was full was dropped, not stacked;
- killing a bot with a stored item dropped it once at the bot's position.

The allowed path (below 20) is not intercepted by the addon. Whether the bot chooses to press
use is the game's AI, not this script.
