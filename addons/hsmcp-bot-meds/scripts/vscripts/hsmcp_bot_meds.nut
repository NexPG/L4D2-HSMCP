// HSMCP Bot Meds
//
// A bot may carry pills or adrenaline, but it may only use them when its total health
// (permanent + temporary) is below 20. While a bot is above that line and takes the item in
// hand, the item is moved into a one-slot hidden inventory keyed by the bot's userid. When
// the bot's health falls below the line, the stored item is returned so the bot can use it.
//
// The item is not left on the ground and is not deleted: DropItem creates a world entity,
// which is killed immediately after the class has been recorded.

HSMCP_BOT_MEDS_THRESHOLD <- 20.0;
HSMCP_BOT_MEDS_DEBUG <- true;
HSMCP_BOT_MEDS_MEDKITS <- false;
HSMCP_HIDDEN <- {};
HSMCP_HIDDEN_KIT <- {};
HSMCP_BOT_MEDS_ANNOUNCED <- false;

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
	if (classname == "weapon_pain_pills" || classname == "weapon_adrenaline")
		return true;
	return HSMCP_BOT_MEDS_MEDKITS && classname == "weapon_first_aid_kit";
}

function HSMCP_IsKit(classname)
{
	return classname == "weapon_first_aid_kit";
}

function HSMCP_SlotFor(classname)
{
	return HSMCP_IsKit(classname) ? HSMCP_HIDDEN_KIT : HSMCP_HIDDEN;
}

function HSMCP_CarriedForSlot(player, isKit)
{
	if (isKit)
		return HSMCP_Carried(player, "weapon_first_aid_kit");
	local entity = HSMCP_Carried(player, "weapon_pain_pills");
	if (entity != null)
		return entity;
	return HSMCP_Carried(player, "weapon_adrenaline");
}

function HSMCP_CarriedAny(player)
{
	local entity = HSMCP_Carried(player, "weapon_pain_pills");
	if (entity != null)
		return entity;
	entity = HSMCP_Carried(player, "weapon_adrenaline");
	if (entity != null)
		return entity;
	if (HSMCP_BOT_MEDS_MEDKITS)
		return HSMCP_Carried(player, "weapon_first_aid_kit");
	return null;
}

/** The weapon entity this player owns, if any. */
function HSMCP_Carried(player, classname)
{
	local entity = null;
	while ((entity = Entities.FindByClassname(entity, classname)) != null)
	{
		if (entity.GetOwnerEntity() == player)
			return entity;
	}
	return null;
}

/** The world entity DropItem just created near this player, excluding the ones already there. */
function HSMCP_NewDropped(player, classname, before)
{
	local entity = null;
	while ((entity = Entities.FindByClassname(entity, classname)) != null)
	{
		if (entity.GetOwnerEntity() != null)
			continue;
		if (before.find(entity) != null)
			continue;
		local delta = entity.GetOrigin() - player.GetOrigin();
		if (delta.Length() > 128.0)
			continue;
		return entity;
	}
	return null;
}

function HSMCP_Store(player, classname)
{
	local userId = player.GetEntityIndex();
	local slot = HSMCP_SlotFor(classname);
	if (userId in slot)
	{
		// The slot is one item. A second item is put back into the world, where a human
		// can take it; it is not silently stacked.
		player.DropItem(classname);
		HSMCP_BotMedsLog("slot full; dropped extra " + classname + " from " + player.GetPlayerName());
		return;
	}

	local before = [];
	local entity = null;
	while ((entity = Entities.FindByClassname(entity, classname)) != null)
	{
		if (entity.GetOwnerEntity() == null)
			before.append(entity);
	}

	player.DropItem(classname);
	local dropped = HSMCP_NewDropped(player, classname, before);
	if (dropped != null)
		dropped.Kill();

	slot[userId] <- { classname = classname, origin = player.GetOrigin() };
	HSMCP_BotMedsLog("stored " + classname + " for " + player.GetPlayerName() +
		" (hp " + HSMCP_TotalHealth(player) + ")");
}

function HSMCP_Return(player)
{
	local userId = player.GetEntityIndex();
	foreach (slot in [HSMCP_HIDDEN, HSMCP_HIDDEN_KIT])
	{
		if (!(userId in slot))
			continue;
		local entry = slot[userId];
		delete slot[userId];
		player.GiveItem(entry.classname);
		HSMCP_BotMedsLog("returned " + entry.classname + " to " + player.GetPlayerName() +
			" (hp " + HSMCP_TotalHealth(player) + ")");
	}
}

function HSMCP_DropStored(player)
{
	local userId = player.GetEntityIndex();
	foreach (slot in [HSMCP_HIDDEN, HSMCP_HIDDEN_KIT])
	{
		if (!(userId in slot))
			continue;
		local entry = slot[userId];
		delete slot[userId];
		HSMCP_SpawnStored(entry, player.GetPlayerName());
	}
}

function HSMCP_SpawnStored(entry, who)
{
	SpawnEntityFromTable(entry.classname, {
		origin = entry.origin,
		angles = Vector(0, 0, 0)
	});
	HSMCP_BotMedsLog("dropped stored " + entry.classname + " at " + who);
}

function HSMCP_BotMedsTick()
{
	if (!HSMCP_BOT_MEDS_ANNOUNCED && Time() > 5.0)
	{
		HSMCP_BOT_MEDS_ANNOUNCED = true;
		HSMCP_BotMedsLog("tick started; threshold " + HSMCP_BOT_MEDS_THRESHOLD);
	}

	local player = null;
	while ((player = Entities.FindByClassname(player, "player")) != null)
	{
		if (!player.IsSurvivor())
			continue;
		if (!HSMCP_IsBot(player))
			continue;
		local userId = player.GetEntityIndex();
		if (player.IsDead())
		{
			// The entity can be gone before the player_death hook sees it; the poller is
			// the reliable place to put a stored item back into the world.
			HSMCP_DropStored(player);
			continue;
		}
		if (player.IsIncapacitated())
			continue;
		local health = HSMCP_TotalHealth(player);

		// Each category has one hidden slot. A full slot means the bot may not take
		// another item of that category; an item it already picked up goes back into the
		// world for a human. The other category is independent, so a stored pill does not
		// make a medkit disappear.
		local pillsStored = userId in HSMCP_HIDDEN;
		local kitStored = userId in HSMCP_HIDDEN_KIT;
		if (pillsStored)
			HSMCP_HIDDEN[userId].origin = player.GetOrigin();
		if (kitStored)
			HSMCP_HIDDEN_KIT[userId].origin = player.GetOrigin();

		if (health < HSMCP_BOT_MEDS_THRESHOLD)
		{
			if (pillsStored || kitStored)
				HSMCP_Return(player);
			continue;
		}

		if (pillsStored)
		{
			local extra = HSMCP_CarriedForSlot(player, false);
			if (extra != null)
			{
				player.DropItem(extra.GetClassname());
				HSMCP_BotMedsLog("pills slot full; dropped carried " + extra.GetClassname() +
					" from " + player.GetPlayerName());
			}
		}
		if (kitStored)
		{
			local kit = HSMCP_CarriedForSlot(player, true);
			if (kit != null)
			{
				player.DropItem(kit.GetClassname());
				HSMCP_BotMedsLog("kit slot full; dropped carried " + kit.GetClassname() +
					" from " + player.GetPlayerName());
			}
		}

		local active = player.GetActiveWeapon();
		if (active == null)
			continue;
		local classname = active.GetClassname();
		if (!HSMCP_IsMed(classname))
			continue;
		if (health < HSMCP_BOT_MEDS_THRESHOLD)
			continue;

		HSMCP_Store(player, classname);
	}
}

