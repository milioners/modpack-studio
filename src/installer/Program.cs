// Точка входа установщика модпака.
//   (без параметров)            — установка; копия в папке игры работает как «Управление модпаком»
//   --preview                   — предпросмотр из конструктора: всё работает, но файлы не ставятся
//   --dir="папка игры"          — папка игры заранее (после обновления модпака)
//   --uninstall                 — удаление (из «Приложений» Windows)
//   --silent --dir=… [--select=id,id] [--clean]  — установка без окна (для проверок и опытных игроков)
//   --silent --uninstall --dir=…                — удаление без окна
//   --screenshot=файл.png --screen=welcome|mods|progress|finish|manage|changelog — снимок окна без показа
using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Windows;

[assembly: AssemblyTitle("TankAir Installer")]

namespace ModPackInstaller
{
    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            Func<string, string> arg = name =>
            {
                var a = args.FirstOrDefault(x => x.StartsWith("--" + name + "=", StringComparison.OrdinalIgnoreCase));
                return a == null ? null : a.Substring(name.Length + 3).Trim('"');
            };
            Func<string, bool> flag = name => args.Any(x => string.Equals(x, "--" + name, StringComparison.OrdinalIgnoreCase));

            var exe = Assembly.GetExecutingAssembly().Location;
            try
            {
                if (!Payload.Open(exe))
                {
                    MessageBox.Show("Установщик повреждён: внутри нет модпака. Скачайте его заново.", "Установщик модпака", MessageBoxButton.OK, MessageBoxImage.Error);
                    return 2;
                }
                var manifest = Manifest.Load(J.Parse(Payload.Text("manifest.json")));

                // Копия в папке игры (modpack_uninstall/<id>/) — режим управления
                var recNearby = Path.Combine(Path.GetDirectoryName(exe), "install.json");
                var nearby = File.Exists(recNearby) ? InstallRecord.Load(recNearby) : null;
                var dir = arg("dir") ?? (nearby != null ? nearby.GameDir : null);

                if (flag("silent"))
                {
                    if (string.IsNullOrEmpty(dir)) dir = Game.Find(null);
                    if (dir == null) { Console.Error.WriteLine("Игра не найдена"); return 3; }
                    var engine = new Engine(manifest);
                    if (flag("uninstall")) { engine.Uninstall(dir); return 0; }
                    var select = arg("select");
                    if (select != null)
                    {
                        var ids = select.Split(',');
                        foreach (var n in manifest.Mods()) n.Selected = ids.Contains(n.Id);
                    }
                    engine.Install(dir, flag("clean"), false);
                    return 0;
                }

                var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
                var mode = flag("preview") ? "preview" : (nearby != null ? "manage" : "install");
                var win = new MainWindow(manifest, mode, dir);
                var shot = arg("screenshot");
                if (shot != null)
                {
                    win.Snapshot(shot, arg("screen") ?? "welcome");
                    app.Run();
                    return 0;
                }
                if (flag("uninstall") && nearby != null)
                {
                    win.Loaded += delegate { win.Dispatcher.BeginInvoke(new Action(() => win.ShowScreen("manage"))); };
                }
                app.Run(win);
                return 0;
            }
            catch (Exception e)
            {
                if (flag("silent") || arg("screenshot") != null) { Console.Error.WriteLine(e); return 1; }
                MessageBox.Show(e.Message, "Установщик модпака", MessageBoxButton.OK, MessageBoxImage.Error);
                return 1;
            }
        }
    }
}
