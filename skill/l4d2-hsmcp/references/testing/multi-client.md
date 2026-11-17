# Testing with more than one client

A single listen server cannot prove a two-team Versus or Scavenge round. These are the
ways to get more than one client on one PC, and what each actually allows.

## What was tried

1. Two `left4dead2.exe` processes with `-multirun`: the second one starts, but its D3D
   device fails in fullscreen (`Failed to create D3D device`).
2. Two processes with `-multirun -windowed -w 1280 -h 720`: **both start**. The second
   connects to `127.0.0.1:27015` and loads the map.
3. The connection is then dropped:

   ```
   STEAMAUTH: Client ... received failure code 8
   Dropped ... from server (No Steam logon)
   Disconnect: No Steam logon.
   ```

One Steam account cannot authenticate two clients. `-insecure` disables VAC, not Steam
identity.

## Solo options that do work

| Option | What it gives | Cost |
|---|---|---|
| Dedicated server + one client | server has no Steam login; survivor bots fill the other team; the client can join Infected | install `srcds` (SteamCMD app `222860`) |
| Second Steam account | two authenticated clients | an account and a second game licence |
| Split-screen | local players on one client | the PC build's split-screen support is not verified here |

The dedicated server is the only route that keeps one account and still gives a populated
server. It is a separate install, not a second login.

## What one client proves

- the mission mode is read (`survival`, `scavenge`, `versus`);
- the map loads with its nav;
- the mode script runs (`anv_versus.nut`);
- the HUD appears (Survival timer, Scavenge score `0 / 16`);
- screenshots of the running map.

It does **not** prove a full two-team round. Say "verified load/HUD", not "round verified",
until a populated server has played it.

## Cleanup

Two windows and a listen server are three processes. Kill every `left4dead2.exe` started by
the test, close the server, and remove the screenshots. The game directory is not a test
artefact store.
