# Campaign is not in the menu

The add-on is enabled but the campaign list shows nothing. Check in this order; each item has
caused this exact symptom.

1. **Mission base name ≠ VPK base name.** `missions/my_campaign.txt` must be inside
   `my_campaign.vpk`. A mismatch shows the archive in the add-on list and hides the campaign.
2. **`Name` is not alphanumeric.** `My_Campaign` and `My Campaign` are invalid; `MyCampaign`
   is not.
3. **No `Image`, or an image that does not resolve.** The campaign needs a VGUI material path
   without extension.
4. **The add-on is disabled.** *Extras → Add-ons* — a disabled add-on is mounted, its
   campaign is not offered.
5. **The game was not restarted** after the VPK was replaced.
6. **A second VPK with the same campaign `Name`.** Remove the older one; the game may load
   either.

## Get the game to say what it read

Launch with `-allowdebug`, then in the console:

```
developer 2
mission_reload
```

The game prints which mission files it read and which it rejected. The reason is usually one
of the six above, in the game's own words.

## Verify the archive, not the staging tree

```
check_campaign(vpk: "<game>/left4dead2/addons/hsmcp_campaign.vpk", entry: "missions/my_campaign.txt")
```

Packing from a stale staging directory is a common cause: the file on disk is correct, the
archive contains an older one.
