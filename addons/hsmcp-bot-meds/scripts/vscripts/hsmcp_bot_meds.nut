// HSMCP Bot Meds
//
// A bot may carry pain pills and adrenaline. It may use them only while its total health
// (permanent + temporary) is below 20. Above that line the item stays in the bot's inventory,
// but the poller switches the bot away from it, so the use animation cannot start. Nothing is
// removed from the inventory and nothing is dropped: the bot can carry the item and give it
// to a teammate later.

HSMCP_BOT_MEDS_THRESHOLD <- 20.0;
HSMCP_BOT_MEDS_DEBUG <- true;

function HSMCP_BotMedsLog(message)
{
	if (HSMCP_BOT_MEDS_DEBUG)
		printl("[HSMCP_BOT_MEDS] " + message);
}

function HSMCP_IsBot(player)
{
	local networkId = player.GetNetworkIDString();
	if (networkId == null)
		return true;
	local lower = networkId.tolower();
	return lower == "bot" || lower == "";
}

function HSMCP_TotalHealth(player)
{
	return player.GetHealth() + player.GetHealthBuffer();
}

function HSMCP_IsMed(classname)
{
	return classname == "weapon_pain_pills" || classname == "weapon_adrenaline";
}

/** A carried weapon that is not a healing item, or the pistol every survivor owns. */
function HSMCP_OtherWeapon(player)
{
	local entity = Entities.First();
	while (entity != null)
	{
		if (entity.GetOwnerEntity() == player)
		{
			local classname = entity.GetClassname();
			if (classname.find("weapon_") == 0 && !HSMCP_IsMed(classname))
				return classname;
		}
		entity = Entities.Next(entity);
	}
	return "weapon_pistol";
}

function HSMCP_BotMedsTick()
{
	local player = null;
	while ((player = Entities.FindByClassname(player, "player")) != null)
	{
		if (!player.IsSurvivor())
			continue;
		if (!HSMCP_IsBot(player))
			continue;
		if (player.IsDead())
			continue;
		if (player.IsIncapacitated())
			continue;

		local active = player.GetActiveWeapon();
		if (active == null)
			continue;
		local classname = active.GetClassname();
		if (!HSMCP_IsMed(classname))
			continue;
		if (HSMCP_TotalHealth(player) < HSMCP_BOT_MEDS_THRESHOLD)
			continue;

		// Keep the item, but take it out of the bot's hands. A bot that switches back is
		// switched away again on the next 0.1 s tick; the pills stay in the inventory.
		local other = HSMCP_OtherWeapon(player);
		if (player.SwitchToItem(other))
			HSMCP_BotMedsLog("locked " + classname + " for " + player.GetPlayerName() +
				" (hp " + HSMCP_TotalHealth(player) + ", switched to " + other + ")");
		else
			HSMCP_BotMedsLog("could not switch " + player.GetPlayerName() + " away from " + classname);
	}
}
