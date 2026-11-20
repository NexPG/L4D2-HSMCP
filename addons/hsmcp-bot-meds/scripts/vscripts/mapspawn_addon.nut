IncludeScript("hsmcp_bot_meds");
IncludeScript("hsmcp_bot_meds_probe"); // TEST ONLY

// mapspawn_addon runs once per chapter in the root scope. The polling itself lives on a
// logic_script entity: its thinkfunction runs every 0.1 s, which is often enough to catch a
// bot that has just switched pills or adrenaline into its hands.
SpawnEntityFromTable("logic_script", {
	targetname = "hsmcp_bot_meds",
	vscripts = "hsmcp_bot_meds_think",
	thinkfunction = "HSMCP_BotMedsThink",
	origin = Vector(0, 0, 0)
});

printl("[HSMCP_BOT_MEDS] mapspawn loaded; threshold " + HSMCP_BOT_MEDS_THRESHOLD);
