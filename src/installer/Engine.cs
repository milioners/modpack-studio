// Движок установщика: поиск игры, установка, удаление, обновление модпака.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace ModPackInstaller
{
    public static class Game
    {
        // Версия клиента из version.xml в формате папки mods/<версия>, например 1.30.0.0
        public static string ReadVersion(string dir)
        {
            try
            {
                var f = Path.Combine(dir, "version.xml");
                if (!File.Exists(f)) return null;
                var text = File.ReadAllText(f);
                var m = Regex.Match(text, @"<version>([\s\S]*?)</version>");
                var raw = m.Success ? m.Groups[1].Value : text;
                var vm = Regex.Match(raw, @"v\.?\s*(\d+(?:\.\d+){1,4})");
                if (!vm.Success) return null;
                var parts = vm.Groups[1].Value.Split('.').ToList();
                while (parts.Count < 4) parts.Add("0");
                var version = string.Join(".", parts.Take(4));
                // если в mods/ уже есть папка этой версии с другим хвостом — используем её
                var mods = Path.Combine(dir, "mods");
                if (Directory.Exists(mods) && !Directory.Exists(Path.Combine(mods, version)))
                {
                    var prefix = string.Join(".", parts.Take(3));
                    var same = Directory.GetDirectories(mods).Select(Path.GetFileName).Where(n => n.StartsWith(prefix)).OrderBy(n => n).ToList();
                    if (same.Count > 0) version = same.Last();
                }
                return version;
            }
            catch { return null; }
        }

        public static string Find(string previous)
        {
            var cands = new List<string>();
            if (!string.IsNullOrEmpty(previous)) cands.Add(previous);
            foreach (var root in new[] { Registry.CurrentUser, Registry.LocalMachine })
                foreach (var key in new[] { @"Software\Microsoft\Windows\CurrentVersion\Uninstall", @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" })
                {
                    try
                    {
                        using (var k = root.OpenSubKey(key))
                        {
                            if (k == null) continue;
                            foreach (var name in k.GetSubKeyNames())
                                using (var sk = k.OpenSubKey(name))
                                {
                                    var loc = sk == null ? null : sk.GetValue("InstallLocation") as string;
                                    var dn = sk == null ? null : (sk.GetValue("DisplayName") as string ?? "");
                                    if (!string.IsNullOrEmpty(loc) && Regex.IsMatch(dn + loc, "tank|танк", RegexOptions.IgnoreCase)) cands.Add(loc);
                                }
                        }
                    }
                    catch { }
                }
            foreach (var d in DriveInfo.GetDrives().Where(x => x.DriveType == DriveType.Fixed).Select(x => x.Name))
                foreach (var sub in new[] { @"Games\Tanki", @"Games\World_of_Tanks_RU", @"Games\Mir_Tankov", @"Tanki", @"Lesta\Tanki", @"Games\World_of_Tanks" })
                    cands.Add(Path.Combine(d, sub));
            foreach (var c in cands)
                if (ReadVersion(c) != null) return c.TrimEnd('\\');
            return null;
        }

        public static string Exe(string dir)
        {
            foreach (var n in new[] { "WorldOfTanks.exe", "Tanki.exe" })
            {
                var p = Path.Combine(dir, n);
                if (File.Exists(p)) return p;
            }
            return null;
        }
    }

    // Запись об установке: что поставлено и что сохранено в бэкап (для удаления и обновления)
    public class InstallRecord
    {
        public string AppId, Name, Version, GameDir, GameVersion, InstalledAt;
        public List<string> Files = new List<string>();
        public List<string[]> Backups = new List<string[]>(); // [путь в игре, путь бэкапа]
        public List<string> Selected = new List<string>();

        public static string Dir(string gameDir, string appId) { return Path.Combine(gameDir, "modpack_uninstall", appId); }
        public static string FileFor(string gameDir, string appId) { return Path.Combine(Dir(gameDir, appId), "install.json"); }

        public static InstallRecord Load(string file)
        {
            if (!File.Exists(file)) return null;
            var j = J.Parse(File.ReadAllText(file, Encoding.UTF8));
            var r = new InstallRecord
            {
                AppId = j.S("appId"), Name = j.S("name"), Version = j.S("version"), GameDir = j.S("gameDir"),
                GameVersion = j.S("gameVersion"), InstalledAt = j.S("installedAt"),
            };
            return Fill(r, file);
        }

        // JavaScriptSerializer не умеет в списки строк через J, поэтому читаем напрямую
        static InstallRecord Fill(InstallRecord r, string file)
        {
            var s = new System.Web.Script.Serialization.JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            var d = s.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8));
            object v;
            if (d.TryGetValue("files", out v) && v is System.Collections.IList) foreach (var x in (System.Collections.IList)v) r.Files.Add((string)x);
            if (d.TryGetValue("selected", out v) && v is System.Collections.IList) foreach (var x in (System.Collections.IList)v) r.Selected.Add((string)x);
            if (d.TryGetValue("backups", out v) && v is System.Collections.IList)
                foreach (var x in (System.Collections.IList)v)
                {
                    var a = (System.Collections.IList)x;
                    r.Backups.Add(new[] { (string)a[0], (string)a[1] });
                }
            return r;
        }

        public void Save(string file)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            var o = new Dictionary<string, object>
            {
                { "appId", AppId }, { "name", Name }, { "version", Version }, { "gameDir", GameDir }, { "gameVersion", GameVersion },
                { "installedAt", InstalledAt }, { "files", Files }, { "backups", Backups }, { "selected", Selected },
            };
            File.WriteAllText(file, J.Write(o), new UTF8Encoding(false));
        }
    }

    public class Engine
    {
        public readonly Manifest M;
        public Action<double, string> Progress = delegate { };
        public Engine(Manifest m) { M = m; }

        static string Stamp() { return DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss"); }

        public string ManagerPath(string gameDir)
        {
            return Path.Combine(InstallRecord.Dir(gameDir, M.AppId), "Управление модпаком.exe");
        }

        public void Install(string gameDir, bool cleanOld, bool shortcut)
        {
            var version = Game.ReadVersion(gameDir);
            if (version == null) throw new Exception("В выбранной папке нет «Мира танков» (не найден version.xml).");
            var recFile = InstallRecord.FileFor(gameDir, M.AppId);
            var stamp = Stamp();
            var backupRoot = Path.Combine(gameDir, "modpack_backup", stamp);

            // Предыдущая установка этого модпака убирается, её бэкапы возвращаются
            var prev = InstallRecord.Load(recFile);
            if (prev != null)
            {
                Progress(0.02, "Убираю предыдущую версию модпака…");
                RemoveFiles(gameDir, prev);
            }

            if (cleanOld)
            {
                Progress(0.05, "Переношу старые моды в modpack_backup…");
                foreach (var sub in new[] { "mods", "res_mods" })
                {
                    var src = Path.Combine(gameDir, sub, version);
                    if (!Directory.Exists(src) || !Directory.EnumerateFileSystemEntries(src).Any()) continue;
                    var dst = Path.Combine(backupRoot, sub, version);
                    Directory.CreateDirectory(Path.GetDirectoryName(dst));
                    Directory.Move(src, dst);
                }
            }

            var rec = new InstallRecord
            {
                AppId = M.AppId, Name = M.Name, Version = M.Version, GameDir = gameDir, GameVersion = version,
                InstalledAt = DateTime.Now.ToString("s"),
            };
            var mods = M.Mods().Where(n => IsSelected(n)).ToList();
            rec.Selected = mods.Select(n => n.Id).ToList();
            long total = Math.Max(1, mods.Sum(n => n.Files.Sum(f => Math.Max(1, f.Size))));
            long done = 0;
            foreach (var mod in mods)
            {
                foreach (var f in mod.Files)
                {
                    var rel = f.Dst.Replace("{game_version}", version).Replace('/', '\\');
                    if (rel.Contains("..") || !(rel.StartsWith("mods\\") || rel.StartsWith("res_mods\\")))
                        throw new Exception("Недопустимый путь в модпаке: " + f.Dst);
                    var dst = Path.Combine(gameDir, rel);
                    Progress(0.08 + 0.9 * done / total, mod.Name);
                    // чужой файл перед перезаписью сохраняется; файл, поставленный этим же модпаком минуту назад, — нет
                    if (File.Exists(dst) && !rec.Files.Contains(rel))
                    {
                        var bak = Path.Combine(backupRoot, "overwritten", rel);
                        Directory.CreateDirectory(Path.GetDirectoryName(bak));
                        File.Copy(dst, bak, true);
                        rec.Backups.Add(new[] { rel, bak.Substring(gameDir.Length + 1) });
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(dst));
                    var e = Payload.Zip.GetEntry(f.Src);
                    if (e == null) throw new Exception("В установщике нет файла " + f.Src + " — файл повреждён.");
                    using (var s = e.Open())
                    using (var o = new FileStream(dst, FileMode.Create, FileAccess.Write))
                        s.CopyTo(o);
                    if (!rec.Files.Contains(rel)) rec.Files.Add(rel);
                    done += Math.Max(1, f.Size);
                }
            }

            Progress(0.98, "Сохраняю сведения об установке…");
            rec.Save(recFile);
            try
            {
                var manager = ManagerPath(gameDir);
                Payload.WriteManager(manager);
                Register(gameDir, manager);
                if (shortcut) Shortcut(manager);
            }
            catch (Exception ex) { Debug.WriteLine(ex); }
            Progress(1, "Готово");
        }

        public static bool IsSelected(Node n) { return !n.IsGroup && n.Selected; }

        public void Uninstall(string gameDir)
        {
            var recFile = InstallRecord.FileFor(gameDir, M.AppId);
            var rec = InstallRecord.Load(recFile);
            if (rec != null) RemoveFiles(gameDir, rec);
            Unregister();
            try
            {
                var lnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), M.Name + ".lnk");
                if (File.Exists(lnk)) File.Delete(lnk);
            }
            catch { }
            // папку с этой программой удаляет отдельный процесс после выхода
            var dir = InstallRecord.Dir(gameDir, M.AppId);
            Process.Start(new ProcessStartInfo("cmd.exe", "/c timeout /t 2 /nobreak >nul & rmdir /s /q \"" + dir + "\"")
            { CreateNoWindow = true, UseShellExecute = false });
        }

        void RemoveFiles(string gameDir, InstallRecord rec)
        {
            foreach (var rel in rec.Files)
            {
                var p = Path.Combine(gameDir, rel);
                try { if (File.Exists(p)) File.Delete(p); } catch { }
                Prune(gameDir, Path.GetDirectoryName(p));
            }
            foreach (var b in rec.Backups)
            {
                var bak = Path.Combine(gameDir, b[1]);
                var dst = Path.Combine(gameDir, b[0]);
                try
                {
                    if (!File.Exists(bak)) continue;
                    Directory.CreateDirectory(Path.GetDirectoryName(dst));
                    File.Copy(bak, dst, true);
                    File.Delete(bak);
                }
                catch { }
            }
        }

        // Пустые папки, оставшиеся от модов, удаляются; mods/<версия> и выше — нет
        static void Prune(string gameDir, string dir)
        {
            var stop = new[] { "mods", "res_mods" }.Select(s => Path.Combine(gameDir, s)).ToList();
            while (dir != null && dir.Length > gameDir.Length && !stop.Contains(dir) && !stop.Contains(Path.GetDirectoryName(dir) ?? ""))
            {
                try
                {
                    if (!Directory.Exists(dir) || Directory.EnumerateFileSystemEntries(dir).Any()) return;
                    Directory.Delete(dir);
                }
                catch { return; }
                dir = Path.GetDirectoryName(dir);
            }
        }

        string UninstallKey { get { return @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ModPack_" + M.AppId; } }

        void Register(string gameDir, string manager)
        {
            using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                k.SetValue("DisplayName", M.Name + " (моды для «Мира танков»)");
                k.SetValue("DisplayVersion", M.Version);
                k.SetValue("Publisher", string.IsNullOrEmpty(M.Author) ? M.Name : M.Author);
                k.SetValue("DisplayIcon", manager);
                k.SetValue("InstallLocation", gameDir);
                k.SetValue("UninstallString", "\"" + manager + "\" --uninstall");
                k.SetValue("ModifyPath", "\"" + manager + "\"");
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                if (!string.IsNullOrEmpty(M.Website)) k.SetValue("URLInfoAbout", M.Website);
            }
        }

        void Unregister()
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }
        }

        void Shortcut(string target)
        {
            var t = Type.GetTypeFromProgID("WScript.Shell");
            if (t == null) return;
            dynamic shell = Activator.CreateInstance(t);
            var lnk = shell.CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), M.Name + ".lnk"));
            lnk.TargetPath = target;
            lnk.WorkingDirectory = Path.GetDirectoryName(target);
            lnk.Description = "Обновление и настройка модпака «" + M.Name + "»";
            lnk.Save();
        }
    }

    // Обновление модпака: GitHub Releases автора или свой адрес с update.json
    public class UpdateInfo
    {
        public string Version, Notes, Url, Sha256, PageUrl;
        public long Size;
    }

    public static class Updater
    {
        static WebClient Client()
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var c = new WebClient { Encoding = Encoding.UTF8 };
            c.Headers[HttpRequestHeader.UserAgent] = "ModPack-Installer";
            return c;
        }

        public static int Compare(string a, string b)
        {
            var pa = (a ?? "").TrimStart('v', 'V').Split('.', '-').Select(x => { int n; return int.TryParse(x, out n) ? n : 0; }).ToArray();
            var pb = (b ?? "").TrimStart('v', 'V').Split('.', '-').Select(x => { int n; return int.TryParse(x, out n) ? n : 0; }).ToArray();
            for (int i = 0; i < Math.Max(pa.Length, pb.Length); i++)
            {
                int x = i < pa.Length ? pa[i] : 0, y = i < pb.Length ? pb[i] : 0;
                if (x != y) return x > y ? 1 : -1;
            }
            return 0;
        }

        // null — обновлений нет или источник не настроен
        public static UpdateInfo Check(Manifest m)
        {
            UpdateInfo u = null;
            using (var c = Client())
            {
                if (m.UpdateType == "github" && !string.IsNullOrEmpty(m.UpdateRepo))
                {
                    c.Headers[HttpRequestHeader.Accept] = "application/vnd.github+json";
                    var j = J.Parse(c.DownloadString("https://api.github.com/repos/" + m.UpdateRepo + "/releases/latest"));
                    var assets = j.A("assets");
                    var exe = assets.FirstOrDefault(a => a.S("name").EndsWith(".exe", StringComparison.OrdinalIgnoreCase));
                    if (exe == null) return null;
                    var sha = assets.FirstOrDefault(a => a.S("name") == exe.S("name") + ".sha256");
                    if (sha == null) return null;
                    var shaText = c.DownloadString(sha.S("browser_download_url"));
                    var hm = Regex.Match(shaText, "[a-fA-F0-9]{64}");
                    if (!hm.Success) return null;
                    u = new UpdateInfo
                    {
                        Version = j.S("tag_name").TrimStart('v', 'V'), Notes = j.S("body"), Url = exe.S("browser_download_url"),
                        Sha256 = hm.Value.ToLowerInvariant(), Size = (long)exe.N("size"), PageUrl = j.S("html_url"),
                    };
                }
                else if (m.UpdateType == "url" && !string.IsNullOrEmpty(m.UpdateUrl))
                {
                    var j = J.Parse(c.DownloadString(m.UpdateUrl));
                    u = new UpdateInfo
                    {
                        Version = j.S("version"), Notes = j.S("notes"), Url = new Uri(new Uri(m.UpdateUrl), j.S("url")).ToString(),
                        Sha256 = j.S("sha256").ToLowerInvariant(), Size = (long)j.N("size"),
                    };
                    if (u.Sha256.Length != 64) return null;
                }
            }
            if (u == null || !u.Url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return null;
            return Compare(u.Version, m.Version) > 0 ? u : null;
        }

        public static string Download(UpdateInfo u, Action<long, long> progress)
        {
            var dir = Path.Combine(Path.GetTempPath(), "modpack-update-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, Path.GetFileName(new Uri(u.Url).LocalPath));
            var req = (HttpWebRequest)WebRequest.Create(u.Url);
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            req.UserAgent = "ModPack-Installer";
            using (var resp = req.GetResponse())
            using (var s = resp.GetResponseStream())
            using (var o = new FileStream(file, FileMode.Create))
            using (var sha = SHA256.Create())
            {
                long total = resp.ContentLength > 0 ? resp.ContentLength : u.Size, got = 0;
                var buf = new byte[81920];
                int r;
                while ((r = s.Read(buf, 0, buf.Length)) > 0)
                {
                    o.Write(buf, 0, r);
                    sha.TransformBlock(buf, 0, r, null, 0);
                    got += r;
                    progress(got, total);
                }
                sha.TransformFinalBlock(new byte[0], 0, 0);
                var hash = BitConverter.ToString(sha.Hash).Replace("-", "").ToLowerInvariant();
                if (hash != u.Sha256)
                {
                    o.Close();
                    File.Delete(file);
                    throw new Exception("Контрольная сумма обновления не совпала — файл повреждён или подменён. Обновление отменено.");
                }
            }
            return file;
        }
    }
}
