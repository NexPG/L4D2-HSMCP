# VScript does not load

The script is written, packed, attached, and nothing appears in the console.

## Prove which layer is broken

Add this as the first line of the script:

```squirrel
printl( "[MYTAG] script loaded" );
```

Launch with `-condebug`, then:

```powershell
Select-String -Path "<game>/left4dead2/console.log" -Pattern "[MYTAG]" -SimpleMatch
```

- **Banner appears** — the file, the archive and the attachment are fine. The problem is later
  in the script.
- **No banner** — go down the list below.

## Layers, in order

1. **Path.** `scripts/vscripts/<name>.nut` inside the add-on VPK. Check the packed entry list;
   a file on disk that is not in the archive does not exist to the game.
2. **Attachment.** A `logic_script` entity with `vscripts` = `<name>` **without** the `.nut`
   extension. Check the compiled BSP with `read_bsp_entities`.
3. **Attachment ran.** A `logic_script` whose `vscripts` is wrong loads nothing and says
   nothing. This is the most common cause.
4. **Syntax.** L4D2 VScript is Squirrel with L4D2 bindings. A Lua- or Source 2-style script
   fails at load; the console log names the line.
5. **Map.** The script is attached in a map you are not loading.

## After the banner appears

If the banner loads but the behaviour does not happen, the engine never called the code. In
L4D2 most behaviour is entity I/O; a script is called by an entity output, a `logic_script`
hook, or a Director script. A function that is defined but never called does nothing. Check
the entity outputs with `read_entity_report` or `validate_io`.
