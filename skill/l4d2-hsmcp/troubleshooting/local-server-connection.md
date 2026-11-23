# Cannot join a local or friend-hosted server

**Prevention.** A player-hosted L4D2 server is reached through a **Steam lobby**, not by
`connect <public-ip>:27015`. Direct IP works only when the host has forwarded **UDP 27015**
and set `sv_allow_lobby_connect_only 0`. Before blaming Steam, check the game's own
`Network: IP` line and whether the server answers A2S.

## Symptom

- Official/Valve and public dedicated servers work.
- A friend's local/listen server does not: the console retries
  `Sending UDP connect to public IP <ip>:27015` forever, or the server kicks with
  `No Steam logon` after about two minutes.
- Friends can join the same server, so the server itself is alive.

## Check, in this order

1. **Which adapter did the game bind?** In `console.log`:
   ```text
   Network: IP 192.0.2.10, mode MP, ports 27015 SV / 27005 CL
   ```
   If it says `<hyper-v-range>` or another Hyper-V/WSL/VPN address, the game is on a virtual
   adapter with no route. Launch with `-ip <active IPv4>` (Steam → Properties → Launch
   Options) or disable the virtual adapter. This alone can make every server fail. The `-ip`
   must be the address of the **currently active** adapter: a phone hotspot changes it, and
   an old `-ip 192.0.2.10` on a hotspot is a dead bind.
2. **Is the server reachable at all?**
   ```powershell
   Test-NetConnection <ip> -Port 27015
   ```
   and an A2S query from the same interface. A TCP/ping/A2S timeout means the host is not
   publishing 27015: a **listen server behind NAT** is normal here; friends reach it through
   a Steam lobby. **Test from a second network** (phone hotspot) as well: if public servers
   answer A2S from that network and the target does not, the target's port is not published;
   the client and its ISP are not the cause. Ping success alone proves only that the router
   answers ICMP, not that the game port is open.
3. **Is the server lobby-only?** On the host, `sv_allow_lobby_connect_only 1` (the default)
   refuses a direct `connect`. The host either invites through Steam or sets it to `0` and
   forwards UDP 27015.
4. **Is the client authenticated?** The game must not run with `-insecure`. Launch options
   should be `-novid -console`, not `-insecure`; `steam_appid.txt` is `550`. `No Steam logon`
   is the client failing to send a ticket, not a map or VMF problem.
5. **Is the host on a different subnet?** `connect 198.51.100.20:27015` from a
   `192.0.2.x` machine has no route. Use the host's public address **and** a forwarded
   port, or the Steam lobby.
6. **Firewall/VPN.** A virtual adapter or VPN that carries the game but not Steam's P2P/SDR
   lets official servers work and local lobbies fail. Test with the VPN off, and allow
   `left4dead2.exe` on Private/Public inbound if the machine hosts.

## Fix matrix

| Situation | Fix |
|---|---|
| Game binds `<hyper-v-range>` / VPN / Hyper-V | `-ip 192.0.2.10` (current Ethernet) or disable the virtual adapter |
| Friend's listen server, no port forward | Join through the Steam lobby/invite, not `connect`; or host forwards UDP 27015 |
| `sv_allow_lobby_connect_only 1` | Host sets `0` for direct joins; otherwise use the lobby |
| `No Steam logon` | Remove `-insecure`; restart Steam; check Steam is online; check `steam_appid.txt` = 550 |
| Official works, local lobby fails | Check Steam P2P/SDR and VPN/router NAT; the game is fine |

## Windows itself: the inbound firewall

Official and community dedicated servers are reached **outbound**, so they work with the
default Windows Firewall. A player-hosted/listen server or Steam P2P may need **inbound**
UDP; Windows blocks inbound by default and the game often has no rule.

Check:

```powershell
Get-NetFirewallRule -DisplayName "*Left 4 Dead*"
Get-NetConnectionProfile
```

A machine with only the Steam/Authoring Tools rules and the Ethernet profile **Public** has
no game inbound rule. Add one (elevated):

```powershell
New-NetFirewallRule -DisplayName "Left 4 Dead 2" -Direction Inbound `
  -Program "<game>\left4dead2.exe" -Action Allow -Profile Private,Public
```

For a host, add the same for `srcds.exe`. For a short controlled test, turning the Windows
Firewall off for the active profile proves whether it is the filter; turn it back on
immediately.

If the rule does not help, check for a leftover VPN/WFP filter (stop the VPN service and
disable its TAP adapter), then `vEthernet (Default Switch)`, then the router's double NAT.

## Player-hosted (listen) servers are a different path

A server a player starts with **Play with Friends → Local Server** is a listen server. It is
reached through a **Steam lobby**, not by treating its public IP as a dedicated server:

- the host creates a Steam lobby and the clients join the lobby/invite;
- Steam may connect them directly or through Steam Datagram Relay (SDR), depending on NAT;
- `connect <public-ip>:27015` works only when the host forwards **UDP 27015** and sets
  `sv_allow_lobby_connect_only 0`;
- a direct A2S query to a NAT'd listen server timing out is normal.

On the client, the paths that make player-hosted fail while official/community dedicated
servers work are:

1. **No inbound firewall rule** for `left4dead2.exe` (Windows may have one for Steam but not
   the game). Add a Private/Public inbound allow.
2. **Virtual adapters / double NAT.** `-ip` fixes the game's server socket, but Steam's
   lobby/P2P may still choose a Hyper-V/WSL/VPN adapter. Disable the virtual adapter for the
   test, or use a phone hotspot with the `-ip` that matches it.
3. **Host is behind NAT/CGNAT.** No port forward = direct `connect` impossible; the lobby/SDR
   path is the only one. The host should verify `status`, `netstat -ano | findstr :27015`,
   `sv_allow_lobby_connect_only`, and the router forward.
4. **Steam lobby/invite itself.** If the lobby cannot be joined but a community dedicated
   server can, compare `console.log` (`CSteam3Client::InitiateConnection`, `lobby`,
   `No Steam logon`) and test on a second network.

A client that joins a community dedicated server through SDR but cannot join any listen
server has working game networking; the remaining layer is the lobby/NAT/firewall path, not
Steam authentication.


## Measured example

On the machine that produced this page:

- `203.0.113.20:27015` → `#Valve_Reject_Server_Full`: the client reached the server and
  Steam authentication worked.
- `203.0.113.21:27015` → `Server using 'public' lobbies`: the client reached it.
- `203.0.113.10:27015` → TCP 27015, ICMP and A2S all timeout; the game retried forever.
  That server is not publishing the port to this client; friends reaching it are using a
  lobby/NAT path, not a direct UDP route.
- Before `-ip`, the same client bound `Network: IP <hyper-v-range>` (Hyper-V Default Switch) and
  could not reach anything. After `-ip 192.0.2.10`, a public server answered.

## What not to conclude

- A ping timeout is not proof the server is down: many hosts block ICMP and A2S.
- A working Steam friends list does not prove game-server UDP works; they are different
  paths.
- Reinstalling L4D2 does not change launch options, `steam_appid.txt`, the Windows adapter
  order, or the router's NAT.
