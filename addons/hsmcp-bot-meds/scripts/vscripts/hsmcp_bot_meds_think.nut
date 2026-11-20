function HSMCP_BotMedsThink()
{
	::HSMCP_BotMedsTick();
}

// Game event hooks must live in the file the logic_script loads. A hook defined in a
// mapspawn_addon is included into the root scope but is not registered by the engine.
function OnGameEvent_player_death(params)
{
	if (!("userid" in params))
		return;
	printl("[PROBE] death userid=" + params.userid + " hidden=" + (params.userid in ::HSMCP_HIDDEN));
	local player = GetPlayerFromUserID(params.userid);
	if (player == null)
		return;
	if (!player.IsSurvivor())
		return;
	::HSMCP_DropStored(player);
}

function OnGameEvent_player_disconnect(params)
{
	if (!("userid" in params))
		return;
	local player = GetPlayerFromUserID(params.userid);
	if (player != null)
		::HSMCP_DropStored(player);
}

function OnGameEvent_map_transition(params)
{
	local player = null;
	while ((player = Entities.FindByClassname(player, "player")) != null)
	{
		if (player.IsSurvivor() && ::HSMCP_IsBot(player))
			::HSMCP_Return(player);
	}
}

function OnGameEvent_round_end(params)
{
	local player = null;
	while ((player = Entities.FindByClassname(player, "player")) != null)
	{
		if (player.IsSurvivor() && ::HSMCP_IsBot(player))
			::HSMCP_DropStored(player);
	}
}
