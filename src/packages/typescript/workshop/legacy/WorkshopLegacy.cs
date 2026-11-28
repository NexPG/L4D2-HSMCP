using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Minimal ISteamRemoteStorage wrapper for the L4D2 Workshop.
//
// L4D2 predates ISteamUGC content transfer: SetItemContent returns k_EResultInvalidParam,
// and so does SteamCMD's workshop_build_item. PublishWorkshopFile and the legacy update
// request are the content path the game's own Authoring Tools still use. This file is
// compiled on demand by the Windows .NET Framework csc.exe, so it needs no NuGet package,
// no SDK and no compiler install. It never sees a password: Steam must be running and the
// account already signed in.
internal static class WorkshopLegacy
{
    private const string HelperVersion = "1";
    private const int ConsumerAppId = 550;
    private const int CallbackPublish = 1309;
    private const int CallbackUpdate = 1316;
    private const int ResultOk = 1;

    private static IntPtr _remoteStorage;
    private static IntPtr _utils;

    private static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("usage: WorkshopLegacy <request file> <response file>");
            return 2;
        }

        Dictionary<string, List<string>> request = ReadRequest(args[0]);
        Dictionary<string, string> response = new Dictionary<string, string>();
        response["helperVersion"] = HelperVersion;
        try
        {
            string command = Get(request, "command");
            if (command.Length == 0) throw new Exception("request has no command");

            if (!Init(response))
            {
                WriteResponse(args[1], response);
                return 1;
            }

            if (command == "env")
            {
                ulong total;
                ulong available;
                bool quota = SteamAPI_ISteamRemoteStorage_GetQuota(_remoteStorage, out total, out available);
                response["quotaRead"] = quota ? "true" : "false";
                response["quotaTotal"] = total.ToString(CultureInfo.InvariantCulture);
                response["quotaAvailable"] = available.ToString(CultureInfo.InvariantCulture);
            }
            else if (command == "publish")
            {
                Publish(request, response);
            }
            else if (command == "update")
            {
                Update(request, response);
            }
            else
            {
                throw new Exception("unknown command: " + command);
            }

            response["ok"] = "true";
        }
        catch (Exception error)
        {
            response["ok"] = "false";
            response["error"] = error.GetType().Name + ": " + error.Message;
        }
        finally
        {
            try { SteamAPI_Shutdown(); } catch { }
        }

        WriteResponse(args[1], response);
        return response["ok"] == "true" ? 0 : 1;
    }

    private static bool Init(Dictionary<string, string> response)
    {
        StringBuilder message = new StringBuilder(4096);
        int result = SteamAPI_InitFlat(message);
        response["initResult"] = result.ToString(CultureInfo.InvariantCulture);
        if (result != 0)
        {
            response["error"] = "SteamAPI_InitFlat failed (" + result + "): " + message.ToString();
            return false;
        }

        _remoteStorage = SteamAPI_SteamRemoteStorage_v016();
        _utils = SteamAPI_SteamUtils_v010();
        if (_remoteStorage == IntPtr.Zero)
        {
            response["error"] = "SteamAPI_SteamRemoteStorage_v016 returned NULL";
            return false;
        }
        if (_utils == IntPtr.Zero)
        {
            response["error"] = "SteamAPI_SteamUtils_v010 returned NULL";
            return false;
        }
        return true;
    }

    private static void Publish(Dictionary<string, List<string>> request, Dictionary<string, string> response)
    {
        string vpk = Get(request, "vpk");
        if (vpk.Length == 0 || !File.Exists(vpk)) throw new Exception("vpk not found: " + vpk);

        string preview = Get(request, "preview");
        if (preview.Length > 0 && !File.Exists(preview)) throw new Exception("preview not found: " + preview);

        string cloudName = Path.GetFileName(vpk);
        UploadCloudFile(cloudName, vpk);

        string previewName = null;
        if (preview.Length > 0)
        {
            previewName = Path.GetFileName(preview);
            UploadCloudFile(previewName, preview);
        }

        IntPtr tagBlock = MakeStringArray(GetAll(request, "tag"));
        string title = Get(request, "title");
        string description = Get(request, "description");
        int visibility = ParseInt(Get(request, "visibility"), 2);

        try
        {
            ulong call = SteamAPI_ISteamRemoteStorage_PublishWorkshopFile(
                _remoteStorage,
                cloudName,
                previewName,
                ConsumerAppId,
                title,
                description,
                visibility,
                tagBlock,
                0);
            response["call"] = call.ToString(CultureInfo.InvariantCulture);
            if (call == 0) throw new Exception("PublishWorkshopFile returned a zero call handle");

            PublishResult result = WaitFor<PublishResult>(call, CallbackPublish);
            response["result"] = result.Result.ToString(CultureInfo.InvariantCulture);
            response["itemId"] = result.ItemId.ToString(CultureInfo.InvariantCulture);
            response["needsAgreement"] = result.NeedsAgreement ? "true" : "false";
            if (result.Result != ResultOk)
            {
                throw new Exception("PublishWorkshopFile failed with EResult " + result.Result);
            }
        }
        finally
        {
            FreeStringArray(tagBlock);
            SteamAPI_ISteamRemoteStorage_FileDelete(_remoteStorage, cloudName);
            if (previewName != null) SteamAPI_ISteamRemoteStorage_FileDelete(_remoteStorage, previewName);
        }
    }

    private static void Update(Dictionary<string, List<string>> request, Dictionary<string, string> response)
    {
        ulong itemId = ParseULong(Get(request, "itemId"), 0);
        if (itemId == 0) throw new Exception("update needs an itemId");

        ulong update = SteamAPI_ISteamRemoteStorage_CreatePublishedFileUpdateRequest(_remoteStorage, itemId);
        response["updateHandle"] = update.ToString(CultureInfo.InvariantCulture);
        if (update == 0) throw new Exception("CreatePublishedFileUpdateRequest returned zero");

        string vpk = Get(request, "vpk");
        string cloudName = null;
        string previewName = null;
        try
        {
            if (vpk.Length > 0)
            {
                if (!File.Exists(vpk)) throw new Exception("vpk not found: " + vpk);
                cloudName = Path.GetFileName(vpk);
                UploadCloudFile(cloudName, vpk);
                if (!SteamAPI_ISteamRemoteStorage_UpdatePublishedFileFile(_remoteStorage, update, cloudName))
                {
                    throw new Exception("UpdatePublishedFileFile was refused");
                }
            }

            string preview = Get(request, "preview");
            if (preview.Length > 0)
            {
                if (!File.Exists(preview)) throw new Exception("preview not found: " + preview);
                previewName = Path.GetFileName(preview);
                UploadCloudFile(previewName, preview);
                if (!SteamAPI_ISteamRemoteStorage_UpdatePublishedFilePreviewFile(_remoteStorage, update, previewName))
                {
                    throw new Exception("UpdatePublishedFilePreviewFile was refused");
                }
            }
            else if (Get(request, "clearPreview") == "true")
            {
                // A NULL preview file removes the main preview image.
                if (!SteamAPI_ISteamRemoteStorage_UpdatePublishedFilePreviewFile(_remoteStorage, update, null))
                {
                    throw new Exception("UpdatePublishedFilePreviewFile (clear) was refused");
                }
            }

            if (Has(request, "title"))
            {
                if (!SteamAPI_ISteamRemoteStorage_UpdatePublishedFileTitle(_remoteStorage, update, Get(request, "title")))
                    throw new Exception("UpdatePublishedFileTitle was refused");
            }

            if (Has(request, "description"))
            {
                if (!SteamAPI_ISteamRemoteStorage_UpdatePublishedFileDescription(_remoteStorage, update, Get(request, "description")))
                    throw new Exception("UpdatePublishedFileDescription was refused");
            }

            if (Has(request, "visibility"))
            {
                if (!SteamAPI_ISteamRemoteStorage_UpdatePublishedFileVisibility(_remoteStorage, update, ParseInt(Get(request, "visibility"), 2)))
                    throw new Exception("UpdatePublishedFileVisibility was refused");
            }

            bool clearTags = Get(request, "clearTags") == "true";
            if (Has(request, "tag") || clearTags)
            {
                string[] tags = clearTags ? new string[0] : GetAll(request, "tag");
                IntPtr tagBlock = MakeStringArray(tags);
                try
                {
                    if (!SteamAPI_ISteamRemoteStorage_UpdatePublishedFileTags(_remoteStorage, update, tagBlock))
                        throw new Exception("UpdatePublishedFileTags was refused");
                }
                finally
                {
                    FreeStringArray(tagBlock);
                }
            }

            if (Has(request, "changeNote"))
            {
                if (!SteamAPI_ISteamRemoteStorage_UpdatePublishedFileSetChangeDescription(_remoteStorage, update, Get(request, "changeNote")))
                    throw new Exception("UpdatePublishedFileSetChangeDescription was refused");
            }

            ulong call = SteamAPI_ISteamRemoteStorage_CommitPublishedFileUpdate(_remoteStorage, update);
            response["call"] = call.ToString(CultureInfo.InvariantCulture);
            if (call == 0) throw new Exception("CommitPublishedFileUpdate returned a zero call handle");

            UpdateResult result = WaitFor<UpdateResult>(call, CallbackUpdate);
            response["result"] = result.Result.ToString(CultureInfo.InvariantCulture);
            response["itemId"] = result.ItemId.ToString(CultureInfo.InvariantCulture);
            response["needsAgreement"] = result.NeedsAgreement ? "true" : "false";
            if (result.Result != ResultOk)
            {
                throw new Exception("CommitPublishedFileUpdate failed with EResult " + result.Result);
            }
        }
        finally
        {
            if (cloudName != null) SteamAPI_ISteamRemoteStorage_FileDelete(_remoteStorage, cloudName);
            if (previewName != null) SteamAPI_ISteamRemoteStorage_FileDelete(_remoteStorage, previewName);
        }
    }

    private static void UploadCloudFile(string cloudName, string path)
    {
        byte[] bytes = File.ReadAllBytes(path);
        if (!SteamAPI_ISteamRemoteStorage_FileWrite(_remoteStorage, cloudName, bytes, bytes.Length))
        {
            throw new Exception(
                "SteamRemoteStorage.FileWrite refused " + cloudName + " (" + bytes.Length +
                " bytes); the Steam Cloud quota is probably too small");
        }
    }

    private static T WaitFor<T>(ulong call, int callbackId) where T : struct
    {
        int size = Marshal.SizeOf(typeof(T));
        DateTime deadline = DateTime.UtcNow.AddMinutes(30);
        while (DateTime.UtcNow < deadline)
        {
            SteamAPI_RunCallbacks();
            bool ioFailure;
            if (SteamAPI_ISteamUtils_IsAPICallCompleted(_utils, call, out ioFailure))
            {
                if (ioFailure) throw new Exception("Steam reported an I/O failure for call " + call);
                IntPtr buffer = Marshal.AllocHGlobal(size);
                try
                {
                    bool failed;
                    bool got = SteamAPI_ISteamUtils_GetAPICallResult(_utils, call, buffer, size, callbackId, out failed);
                    if (!got) throw new Exception("GetAPICallResult refused call " + call);
                    if (failed) throw new Exception("Steam reported a failed call " + call);
                    return (T)Marshal.PtrToStructure(buffer, typeof(T));
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            Thread.Sleep(50);
        }
        throw new TimeoutException("Steam did not answer call " + call + " within 30 minutes");
    }

    // --- request/response: tab-separated key and base64(UTF-8) value ---

    private static Dictionary<string, List<string>> ReadRequest(string path)
    {
        Dictionary<string, List<string>> values = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (string line in File.ReadAllLines(path, Encoding.UTF8))
        {
            int tab = line.IndexOf('\t');
            if (tab <= 0) continue;
            string key = line.Substring(0, tab);
            string value = Decode(line.Substring(tab + 1));
            List<string> list;
            if (!values.TryGetValue(key, out list))
            {
                list = new List<string>();
                values[key] = list;
            }
            list.Add(value);
        }
        return values;
    }

    private static void WriteResponse(string path, Dictionary<string, string> values)
    {
        List<string> lines = new List<string>();
        foreach (KeyValuePair<string, string> pair in values)
        {
            lines.Add(pair.Key + "\t" + Encode(pair.Value));
        }
        File.WriteAllLines(path, lines.ToArray(), new UTF8Encoding(false));
    }

    private static string Encode(string value)
    {
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? ""));
    }

    private static string Decode(string value)
    {
        return Encoding.UTF8.GetString(Convert.FromBase64String(value));
    }

    private static string Get(Dictionary<string, List<string>> values, string key)
    {
        List<string> list;
        return values.TryGetValue(key, out list) && list.Count > 0 ? list[0] : "";
    }

    private static string[] GetAll(Dictionary<string, List<string>> values, string key)
    {
        List<string> list;
        return values.TryGetValue(key, out list) ? list.ToArray() : new string[0];
    }

    private static bool Has(Dictionary<string, List<string>> values, string key)
    {
        return values.ContainsKey(key);
    }

    private static int ParseInt(string value, int fallback)
    {
        int parsed;
        return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) ? parsed : fallback;
    }

    private static ulong ParseULong(string value, ulong fallback)
    {
        ulong parsed;
        return ulong.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) ? parsed : fallback;
    }

    // --- interop ---

    [StructLayout(LayoutKind.Sequential)]
    private struct SteamParamStringArray
    {
        public IntPtr Strings;
        public int Count;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PublishResult
    {
        public int Result;
        public ulong ItemId;
        [MarshalAs(UnmanagedType.I1)] public bool NeedsAgreement;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct UpdateResult
    {
        public int Result;
        public ulong ItemId;
        [MarshalAs(UnmanagedType.I1)] public bool NeedsAgreement;
    }

    /// <summary>
    /// Allocates a SteamParamStringArray_t. An empty array is a valid block with count 0:
    /// that is how a legacy update clears every tag. The caller frees it with FreeStringArray.
    /// </summary>
    private static IntPtr MakeStringArray(string[] values)
    {
        IntPtr[] strings = new IntPtr[values.Length];
        IntPtr array = IntPtr.Zero;
        try
        {
            for (int i = 0; i < values.Length; i++) strings[i] = Utf8ToHGlobal(values[i]);
            if (values.Length > 0)
            {
                array = Marshal.AllocHGlobal(IntPtr.Size * values.Length);
                Marshal.Copy(strings, 0, array, values.Length);
            }
            SteamParamStringArray block = new SteamParamStringArray();
            block.Strings = array;
            block.Count = values.Length;
            IntPtr pointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SteamParamStringArray)));
            Marshal.StructureToPtr(block, pointer, false);
            return pointer;
        }
        catch
        {
            foreach (IntPtr item in strings) if (item != IntPtr.Zero) Marshal.FreeHGlobal(item);
            if (array != IntPtr.Zero) Marshal.FreeHGlobal(array);
            throw;
        }
    }

    private static void FreeStringArray(IntPtr pointer)
    {
        if (pointer == IntPtr.Zero) return;
        SteamParamStringArray block = (SteamParamStringArray)Marshal.PtrToStructure(pointer, typeof(SteamParamStringArray));
        for (int i = 0; i < block.Count; i++)
        {
            IntPtr item = Marshal.ReadIntPtr(block.Strings, i * IntPtr.Size);
            if (item != IntPtr.Zero) Marshal.FreeHGlobal(item);
        }
        if (block.Strings != IntPtr.Zero) Marshal.FreeHGlobal(block.Strings);
        Marshal.FreeHGlobal(pointer);
    }

    private static IntPtr Utf8ToHGlobal(string value)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(value ?? "");
        IntPtr pointer = Marshal.AllocHGlobal(bytes.Length + 1);
        Marshal.Copy(bytes, 0, pointer, bytes.Length);
        Marshal.WriteByte(pointer, bytes.Length, 0);
        return pointer;
    }

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private static extern int SteamAPI_InitFlat(StringBuilder message);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern void SteamAPI_Shutdown();

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern void SteamAPI_RunCallbacks();

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr SteamAPI_SteamRemoteStorage_v016();

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr SteamAPI_SteamUtils_v010();

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SteamAPI_ISteamRemoteStorage_FileWrite(IntPtr self, [MarshalAs(UnmanagedType.LPUTF8Str)] string file, byte[] data, int size);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SteamAPI_ISteamRemoteStorage_FileDelete(IntPtr self, [MarshalAs(UnmanagedType.LPUTF8Str)] string file);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SteamAPI_ISteamRemoteStorage_GetQuota(IntPtr self, out ulong total, out ulong available);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern ulong SteamAPI_ISteamRemoteStorage_PublishWorkshopFile(
        IntPtr self,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string file,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string preview,
        uint consumerAppId,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string title,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string description,
        int visibility,
        IntPtr tags,
        int fileType);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern ulong SteamAPI_ISteamRemoteStorage_CreatePublishedFileUpdateRequest(IntPtr self, ulong itemId);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SteamAPI_ISteamRemoteStorage_UpdatePublishedFileFile(IntPtr self, ulong update, [MarshalAs(UnmanagedType.LPUTF8Str)] string file);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SteamAPI_ISteamRemoteStorage_UpdatePublishedFilePreviewFile(IntPtr self, ulong update, [MarshalAs(UnmanagedType.LPUTF8Str)] string preview);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SteamAPI_ISteamRemoteStorage_UpdatePublishedFileTitle(IntPtr self, ulong update, [MarshalAs(UnmanagedType.LPUTF8Str)] string title);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SteamAPI_ISteamRemoteStorage_UpdatePublishedFileDescription(IntPtr self, ulong update, [MarshalAs(UnmanagedType.LPUTF8Str)] string description);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SteamAPI_ISteamRemoteStorage_UpdatePublishedFileVisibility(IntPtr self, ulong update, int visibility);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SteamAPI_ISteamRemoteStorage_UpdatePublishedFileTags(IntPtr self, ulong update, IntPtr tags);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SteamAPI_ISteamRemoteStorage_UpdatePublishedFileSetChangeDescription(IntPtr self, ulong update, [MarshalAs(UnmanagedType.LPUTF8Str)] string note);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern ulong SteamAPI_ISteamRemoteStorage_CommitPublishedFileUpdate(IntPtr self, ulong update);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SteamAPI_ISteamUtils_IsAPICallCompleted(IntPtr self, ulong call, [MarshalAs(UnmanagedType.I1)] out bool failed);

    [DllImport("steam_api64.dll", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SteamAPI_ISteamUtils_GetAPICallResult(IntPtr self, ulong call, IntPtr callback, int size, int expected, [MarshalAs(UnmanagedType.I1)] out bool failed);
}
