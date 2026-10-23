// Модель модпака: читается из manifest.json внутри встроенного архива.
// Язык — C# 5 (компилятор csc из .NET Framework 4.8, который есть в любой Windows 10/11).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;

namespace ModPackInstaller
{
    // Доступ к полям JSON без жёстких классов: отсутствующее поле даёт значение по умолчанию
    public class J
    {
        readonly Dictionary<string, object> d;
        public J(object o) { d = o as Dictionary<string, object> ?? new Dictionary<string, object>(); }
        public bool Has(string k) { return d.ContainsKey(k) && d[k] != null; }
        public string S(string k, string def = "")
        {
            object v;
            if (!d.TryGetValue(k, out v) || v == null) return def;
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }
        public double N(string k, double def = 0)
        {
            object v;
            if (!d.TryGetValue(k, out v) || v == null) return def;
            try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); } catch { return def; }
        }
        public bool B(string k, bool def = false)
        {
            object v;
            if (!d.TryGetValue(k, out v) || v == null) return def;
            if (v is bool) return (bool)v;
            return def;
        }
        public J O(string k) { object v; d.TryGetValue(k, out v); return new J(v); }
        public List<J> A(string k)
        {
            object v;
            var list = new List<J>();
            // DeserializeObject отдаёт массивы как object[], Deserialize<T> — как ArrayList
            if (d.TryGetValue(k, out v) && v is System.Collections.IList)
                foreach (var x in (System.Collections.IList)v) list.Add(new J(x));
            return list;
        }
        public static J Parse(string json)
        {
            var s = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 200 };
            return new J(s.DeserializeObject(json));
        }
        public static string Write(object o)
        {
            var s = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            return s.Serialize(o);
        }
    }

    public class ModFile
    {
        public string Src;   // путь внутри архива
        public string Dst;   // путь в игре с {game_version}
        public long Size;
    }

    public class Node
    {
        public string Id, Type, Name, Description, Version, Author, Image, Mode;
        public bool Checked;      // выбор по умолчанию
        public bool Selected;     // текущий выбор игрока
        public long Size;
        public Node Parent;
        public List<Node> Children = new List<Node>();
        public List<ModFile> Files = new List<ModFile>();
        public bool IsGroup { get { return Type == "group"; } }
        public bool IsRadio { get { return !IsGroup && Parent != null && Parent.Mode == "single"; } }

        public IEnumerable<Node> Walk()
        {
            yield return this;
            foreach (var c in Children) foreach (var x in c.Walk()) yield return x;
        }
        public IEnumerable<Node> Mods() { return Walk().Where(n => !n.IsGroup); }
        public string Path
        {
            get
            {
                var parts = new List<string>();
                for (var p = Parent; p != null; p = p.Parent) parts.Insert(0, p.Name);
                return string.Join(" › ", parts);
            }
        }
    }

    public class ChangelogEntry { public string Version, Date, Text; }

    public class Manifest
    {
        public string AppId, Name, Version, Author, Website, GameVersion, Description;
        public bool CleanDefault, LaunchGame;
        public string UpdateType, UpdateRepo, UpdateUrl;
        public J Theme;
        public List<Node> Tree = new List<Node>();
        public List<ChangelogEntry> Changelog = new List<ChangelogEntry>();

        public IEnumerable<Node> All() { return Tree.SelectMany(n => n.Walk()); }
        public IEnumerable<Node> Mods() { return All().Where(n => !n.IsGroup); }

        public static Manifest Load(J j)
        {
            var m = new Manifest();
            var info = j.O("info");
            m.AppId = j.S("appId");
            m.Name = info.S("name", "Модпак");
            m.Version = info.S("version", "1.0");
            m.Author = info.S("author");
            m.Website = info.S("website");
            m.GameVersion = info.S("gameVersion");
            m.Description = info.S("description");
            var o = j.O("options");
            m.CleanDefault = o.B("cleanDefault", true);
            m.LaunchGame = o.B("launchGame", true);
            var u = j.O("update");
            m.UpdateType = u.S("type", "none");
            m.UpdateRepo = u.S("repo");
            m.UpdateUrl = u.S("url");
            m.Theme = j.O("theme");
            foreach (var e in j.A("changelog"))
                m.Changelog.Add(new ChangelogEntry { Version = e.S("version"), Date = e.S("date"), Text = e.S("text") });
            foreach (var n in j.A("tree")) m.Tree.Add(ParseNode(n, null));
            return m;
        }

        static Node ParseNode(J j, Node parent)
        {
            var n = new Node
            {
                Id = j.S("id"), Type = j.S("type", "mod"), Name = j.S("name"), Description = j.S("description"),
                Version = j.S("version"), Author = j.S("author"), Image = j.S("image"), Mode = j.S("mode", "multi"),
                Checked = j.B("checked", true), Size = (long)j.N("size"), Parent = parent,
            };
            n.Selected = n.Checked;
            foreach (var f in j.A("files")) n.Files.Add(new ModFile { Src = f.S("src"), Dst = f.S("dst"), Size = (long)f.N("size") });
            foreach (var c in j.A("children")) n.Children.Add(ParseNode(c, n));
            return n;
        }
    }

    // Архив, дописанный в конец exe: [программа][zip][длина zip: 8 байт][«MPSPACK1»]
    public static class Payload
    {
        static readonly byte[] Magic = Encoding.ASCII.GetBytes("MPSPACK1");
        public static ZipArchive Zip;
        public static long StubLength;
        public static string ExePath;

        public static bool Open(string exe)
        {
            ExePath = exe;
            var fs = new FileStream(exe, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (fs.Length < 16) { fs.Dispose(); return false; }
            var tail = new byte[16];
            fs.Seek(-16, SeekOrigin.End);
            fs.Read(tail, 0, 16);
            for (int i = 0; i < 8; i++) if (tail[8 + i] != Magic[i]) { fs.Dispose(); return false; }
            long zipLen = BitConverter.ToInt64(tail, 0);
            long start = fs.Length - 16 - zipLen;
            if (zipLen <= 0 || start <= 0) { fs.Dispose(); return false; }
            StubLength = start;
            Zip = new ZipArchive(new SubStream(fs, start, zipLen), ZipArchiveMode.Read);
            return true;
        }

        public static byte[] Bytes(string name)
        {
            var e = Zip.GetEntry(name);
            if (e == null) return null;
            using (var s = e.Open())
            using (var ms = new MemoryStream())
            {
                s.CopyTo(ms);
                return ms.ToArray();
            }
        }

        public static string Text(string name)
        {
            var b = Bytes(name);
            return b == null ? null : Encoding.UTF8.GetString(b).TrimStart('﻿');
        }

        // Копия установщика без файлов модов: ставится в игру для обновления и удаления модпака
        public static void WriteManager(string path)
        {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
            var tmp = path + ".tmp";
            using (var outFs = new FileStream(tmp, FileMode.Create, FileAccess.ReadWrite))
            {
                using (var exe = new FileStream(ExePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    CopyN(exe, outFs, StubLength);
                long zipStart = outFs.Position;
                using (var sub = new SubStream(outFs, zipStart, long.MaxValue - zipStart, true))
                using (var z = new ZipArchive(sub, ZipArchiveMode.Create, true))
                {
                    foreach (var e in Zip.Entries)
                    {
                        if (e.FullName.StartsWith("mods/")) continue;
                        var ne = z.CreateEntry(e.FullName, CompressionLevel.Fastest);
                        using (var src = e.Open()) using (var dst = ne.Open()) src.CopyTo(dst);
                    }
                }
                long zipLen = outFs.Length - zipStart;
                outFs.Seek(0, SeekOrigin.End);
                outFs.Write(BitConverter.GetBytes(zipLen), 0, 8);
                outFs.Write(Magic, 0, 8);
            }
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }

        static void CopyN(Stream from, Stream to, long n)
        {
            var buf = new byte[81920];
            while (n > 0)
            {
                int r = from.Read(buf, 0, (int)Math.Min(buf.Length, n));
                if (r <= 0) break;
                to.Write(buf, 0, r);
                n -= r;
            }
        }
    }

    // Окно в файле: часть потока, видимая как отдельный поток с собственным началом
    public class SubStream : Stream
    {
        readonly Stream s;
        readonly long start, len;
        readonly bool writable;
        long pos;
        public SubStream(Stream s, long start, long len, bool writable = false)
        {
            this.s = s; this.start = start; this.len = len; this.writable = writable;
        }
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return true; } }
        public override bool CanWrite { get { return writable; } }
        public override long Length { get { return writable ? s.Length - start : len; } }
        public override long Position { get { return pos; } set { pos = value; } }
        public override void Flush() { s.Flush(); }
        public override int Read(byte[] buffer, int offset, int count)
        {
            long left = Length - pos;
            if (left <= 0) return 0;
            if (count > left) count = (int)left;
            s.Seek(start + pos, SeekOrigin.Begin);
            int r = s.Read(buffer, offset, count);
            pos += r;
            return r;
        }
        public override long Seek(long offset, SeekOrigin origin)
        {
            if (origin == SeekOrigin.Begin) pos = offset;
            else if (origin == SeekOrigin.Current) pos += offset;
            else pos = Length + offset;
            return pos;
        }
        public override void SetLength(long value) { if (!writable) throw new NotSupportedException(); s.SetLength(start + value); }
        public override void Write(byte[] buffer, int offset, int count)
        {
            if (!writable) throw new NotSupportedException();
            s.Seek(start + pos, SeekOrigin.Begin);
            s.Write(buffer, offset, count);
            pos += count;
        }
    }
}
