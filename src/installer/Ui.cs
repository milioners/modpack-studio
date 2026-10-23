// Интерфейс установщика. Экраны рисуются по раскладке автора (theme.layout): элементы со свободными координатами,
// своими цветами, шрифтами и условиями показа. Палитра темы (@accent, @text…) задаёт цвета по умолчанию.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using Path = System.Windows.Shapes.Path;

namespace ModPackInstaller
{
    public class Theme
    {
        public Dictionary<string, Color> Palette = new Dictionary<string, Color>();
        public string BgImage, Banner, Logo, Font, TitleFont;
        public double Radius, FontSize, SurfaceOpacity;
        public bool Animations;
        public string WelcomeTitle, WelcomeText, InstallText, FinishTitle, FinishText;
        public J Layout;

        public Color Bg { get { return Palette["bg"]; } }
        public Color Surface { get { return Palette["surface"]; } }
        public Color Card { get { return Palette["card"]; } }
        public Color Border { get { return Palette["border"]; } }
        public Color Text { get { return Palette["text"]; } }
        public Color Muted { get { return Palette["muted"]; } }
        public Color Accent { get { return Palette["accent"]; } }
        public Color AccentText { get { return Palette["accentText"]; } }
        public Color Danger { get { return Palette["danger"]; } }
        public Color Success { get { return Palette["success"]; } }

        static Color Parse(string s, string def)
        {
            try { return (Color)ColorConverter.ConvertFromString(string.IsNullOrEmpty(s) ? def : s); }
            catch { return (Color)ColorConverter.ConvertFromString(def); }
        }

        // '#rrggbb', '#aarrggbb' или ссылка на палитру '@accent'
        public Color C(string s, string def = "@text")
        {
            if (string.IsNullOrEmpty(s)) s = def;
            if (s.StartsWith("@"))
            {
                Color c;
                return Palette.TryGetValue(s.Substring(1), out c) ? c : Palette["text"];
            }
            return Parse(s, "#FF00FF");
        }

        public string FontName(string f)
        {
            if (string.IsNullOrEmpty(f) || f == "@font") return Font;
            if (f == "@titleFont") return TitleFont;
            return f;
        }

        static string Or(string s, string def) { return string.IsNullOrWhiteSpace(s) ? def : s; }

        public static Theme From(J t, Manifest m)
        {
            var c = t.O("colors");
            var x = t.O("texts");
            var th = new Theme();
            var defs = new Dictionary<string, string>
            {
                { "bg", "#0F1115" }, { "surface", "#181B21" }, { "card", "#1F232B" }, { "border", "#2C313B" }, { "text", "#EEE9DF" },
                { "muted", "#8F8A80" }, { "accent", "#F0A53A" }, { "accentText", "#1D1305" }, { "danger", "#EF5D55" }, { "success", "#5CC98A" },
            };
            foreach (var kv in defs) th.Palette[kv.Key] = Parse(c.S(kv.Key), kv.Value);
            th.BgImage = t.S("bgImage"); th.Banner = t.S("banner"); th.Logo = t.S("logo");
            th.Font = t.S("font", "Segoe UI"); th.TitleFont = t.S("titleFont", th.Font);
            th.Radius = t.N("radius", 12); th.FontSize = t.N("fontSize", 13); th.SurfaceOpacity = t.N("surfaceOpacity", 0.92);
            th.Animations = t.B("animations", true);
            th.WelcomeTitle = Or(x.S("welcomeTitle"), m.Name); th.WelcomeText = Or(x.S("welcomeText"), m.Description);
            th.InstallText = Or(x.S("installButton"), "Установить"); th.FinishTitle = Or(x.S("finishTitle"), "Готово!");
            th.FinishText = Or(x.S("finishText"), "Модпак «" + m.Name + "» установлен. Можно запускать игру!");
            th.Layout = t.O("layout");
            return th;
        }

        public SolidColorBrush B(Color c, double opacity = 1)
        {
            var b = new SolidColorBrush(Color.FromArgb((byte)(c.A * opacity), c.R, c.G, c.B));
            b.Freeze();
            return b;
        }
    }

    public class MainWindow : Window
    {
        readonly Manifest M;
        readonly Theme T;
        readonly string Mode; // install | preview | manage
        readonly Dictionary<string, BitmapImage> images = new Dictionary<string, BitmapImage>();
        readonly double WinW, WinH, WinR;
        Border outer;
        Grid bgLayer, overlay;
        Canvas canvas;
        string screen;
        UpdateInfo update;
        string gameDir, gameVersion;
        InstallRecord installed;
        Node current;
        string category = "all", query = "";
        bool cleanOld, shortcut = true;
        ScrollViewer listScroll;
        Panel detailHost;
        J listProps;
        Action<double, string> progress;
        readonly List<KeyValuePair<TextBlock, string>> liveTexts = new List<KeyValuePair<TextBlock, string>>();

        public MainWindow(Manifest m, string mode, string gameDirArg)
        {
            M = m;
            Mode = mode;
            T = Theme.From(m.Theme, m);
            var win = T.Layout.O("window");
            WinW = win.N("width", 1100);
            WinH = win.N("height", 700);
            WinR = win.N("radius", 14);
            cleanOld = m.CleanDefault;
            Title = m.Name;
            Width = WinW + 24;
            Height = WinH + 24;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ResizeMode = ResizeMode.NoResize;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            FontFamily = new FontFamily(T.Font + ", Segoe UI");
            FontSize = T.FontSize;
            Foreground = T.B(T.Text);
            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Display);
            UseLayoutRounding = true;
            LoadScrollStyle();

            gameDir = gameDirArg ?? Game.Find(null);
            RefreshGame();
            Content = BuildShell();
            ShowScreen(Mode == "manage" ? "manage" : "welcome");
            Loaded += delegate { CheckUpdateAsync(); };
        }

        void RefreshGame()
        {
            gameVersion = gameDir == null ? null : Game.ReadVersion(gameDir);
            installed = gameVersion == null ? null : InstallRecord.Load(InstallRecord.FileFor(gameDir, M.AppId));
            // при переустановке выбор игрока восстанавливается
            if (installed != null && installed.Selected.Count > 0 && Mode != "manage")
                foreach (var n in M.Mods()) n.Selected = installed.Selected.Contains(n.Id);
        }

        // ---------- общие помощники ----------

        void LoadScrollStyle()
        {
            var thumb = T.Muted;
            var xaml = "<ResourceDictionary xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml'>"
                + "<Style x:Key='{x:Type ScrollBar}' TargetType='ScrollBar'><Setter Property='Width' Value='10'/><Setter Property='MinWidth' Value='10'/>"
                + "<Setter Property='Template'><Setter.Value><ControlTemplate TargetType='ScrollBar'><Track x:Name='PART_Track' IsDirectionReversed='True'>"
                + "<Track.Thumb><Thumb><Thumb.Template><ControlTemplate TargetType='Thumb'><Border CornerRadius='4' Margin='2' Opacity='0.45' Background='#"
                + thumb.R.ToString("X2") + thumb.G.ToString("X2") + thumb.B.ToString("X2") + "'/></ControlTemplate></Thumb.Template></Thumb></Track.Thumb>"
                + "</Track></ControlTemplate></Setter.Value></Setter></Style></ResourceDictionary>";
            try { Resources.MergedDictionaries.Add((ResourceDictionary)XamlReader.Parse(xaml)); } catch { }
        }

        public BitmapImage Img(string path)
        {
            if (string.IsNullOrEmpty(path)) return null;
            if (path == "@logo") path = T.Logo;
            if (path == "@banner") path = T.Banner;
            if (string.IsNullOrEmpty(path)) return null;
            BitmapImage b;
            if (images.TryGetValue(path, out b)) return b;
            var bytes = Payload.Bytes(path);
            if (bytes == null) return images[path] = null;
            b = new BitmapImage();
            b.BeginInit();
            b.CacheOption = BitmapCacheOption.OnLoad;
            b.StreamSource = new MemoryStream(bytes);
            b.EndInit();
            b.Freeze();
            return images[path] = b;
        }

        CornerRadius R(double k = 1) { return new CornerRadius(Math.Max(0, T.Radius * k)); }

        TextBlock Text(string s, double size = 0, FontWeight? w = null, Color? color = null, bool wrap = false, bool title = false)
        {
            var t = new TextBlock { Text = s ?? "", FontSize = size > 0 ? size : T.FontSize, Foreground = T.B(color ?? T.Text) };
            if (w.HasValue) t.FontWeight = w.Value;
            if (title) t.FontFamily = new FontFamily(T.TitleFont + ", " + T.Font + ", Segoe UI");
            if (wrap) t.TextWrapping = TextWrapping.Wrap; else t.TextTrimming = TextTrimming.CharacterEllipsis;
            return t;
        }

        // Кнопка интерфейса (виджеты, окна поверх): kind = primary | ghost | danger | default
        Border Button(string text, string kind, Action click, double height = 40)
        {
            var fg = kind == "primary" ? T.AccentText : kind == "danger" ? T.Danger : T.Text;
            var bg = kind == "primary" ? T.B(T.Accent) : kind == "ghost" ? Brushes.Transparent : T.B(T.Card, T.SurfaceOpacity);
            var b = new Border
            {
                CornerRadius = R(0.75), Height = height, Padding = new Thickness(height > 36 ? 20 : 12, 0, height > 36 ? 20 : 12, 0),
                Background = bg,
                BorderBrush = kind == "danger" ? T.B(T.Danger, 0.6) : kind == "primary" ? T.B(T.Accent) : T.B(T.Border),
                BorderThickness = new Thickness(kind == "ghost" ? 0 : 1),
                Child = new TextBlock
                {
                    Text = text, Foreground = T.B(fg), FontWeight = kind == "primary" ? FontWeights.Bold : FontWeights.SemiBold,
                    VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center,
                },
            };
            Clickable(b, click);
            return b;
        }

        // Интерактивные элементы помечены Tag = "i": за них окно не перетаскивается
        void Clickable(FrameworkElement b, Action click)
        {
            b.Tag = "i";
            b.Cursor = Cursors.Hand;
            b.MouseEnter += delegate { b.Opacity = 0.86; };
            b.MouseLeave += delegate { b.Opacity = 1; };
            b.MouseLeftButtonDown += delegate (object s, MouseButtonEventArgs e) { e.Handled = true; };
            b.MouseLeftButtonUp += delegate (object s, MouseButtonEventArgs e) { e.Handled = true; click(); };
        }

        Border Box(UIElement child, Thickness? pad = null)
        {
            return new Border
            {
                Background = T.B(T.Surface, T.SurfaceOpacity), CornerRadius = R(), BorderBrush = T.B(T.Border), BorderThickness = new Thickness(1),
                Padding = pad ?? new Thickness(18), Child = child,
            };
        }

        FrameworkElement Indicator(bool radio, bool on, double size = 22)
        {
            var g = new Grid { Width = size, Height = size };
            g.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(radio ? size / 2 : 6), BorderThickness = new Thickness(2),
                BorderBrush = on ? T.B(T.Accent) : T.B(T.Text, 0.55), Background = on ? T.B(T.Accent) : T.B(Colors.Black, 0.35),
            });
            if (on)
            {
                if (radio) g.Children.Add(new Ellipse { Width = size * 0.36, Height = size * 0.36, Fill = T.B(T.AccentText) });
                else g.Children.Add(new Path
                {
                    Data = Geometry.Parse("M 5,11 L 9,15 L 17,7"), Stroke = T.B(T.AccentText), StrokeThickness = 2.6,
                    StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, Width = size, Height = size, Stretch = Stretch.None,
                });
            }
            return g;
        }

        FrameworkElement Toggle(string label, bool value, Action<bool> changed)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 18, 0) };
            var track = new Border { Width = 36, Height = 20, CornerRadius = new CornerRadius(10), VerticalAlignment = VerticalAlignment.Center, BorderThickness = new Thickness(1) };
            var knob = new Ellipse { Width = 14, Height = 14, Margin = new Thickness(3, 0, 3, 0) };
            track.Child = knob;
            Action paint = delegate
            {
                track.Background = value ? T.B(T.Accent) : T.B(T.Card);
                track.BorderBrush = value ? T.B(T.Accent) : T.B(T.Border);
                knob.Fill = value ? T.B(T.AccentText) : T.B(T.Muted);
                knob.HorizontalAlignment = value ? HorizontalAlignment.Right : HorizontalAlignment.Left;
            };
            paint();
            sp.Children.Add(track);
            var t = Text(label, 0, null, T.Text);
            t.Margin = new Thickness(9, 0, 0, 0);
            t.VerticalAlignment = VerticalAlignment.Center;
            sp.Children.Add(t);
            Clickable(sp, delegate { value = !value; paint(); changed(value); });
            return sp;
        }

        static string Size(long b)
        {
            if (b < 1024 * 1024) return Math.Max(1, b / 1024) + " КБ";
            return (b / 1024.0 / 1024.0).ToString("0.0") + " МБ";
        }

        Border WinButton(string path, Action click)
        {
            var b = new Border
            {
                Width = 36, Height = 32, CornerRadius = R(0.5), Background = Brushes.Transparent,
                Child = new Path { Data = Geometry.Parse(path), Stroke = T.B(T.Muted), StrokeThickness = 1.4, Width = 10, Height = 10, Stretch = Stretch.None,
                    HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center },
            };
            Clickable(b, click);
            b.MouseEnter += delegate { b.Background = T.B(T.Card); };
            b.MouseLeave += delegate { b.Background = Brushes.Transparent; };
            return b;
        }

        // ---------- каркас и экраны по раскладке ----------

        UIElement BuildShell()
        {
            outer = new Border
            {
                Margin = new Thickness(12), CornerRadius = new CornerRadius(WinR), Background = T.B(T.Bg), Width = WinW, Height = WinH,
                BorderBrush = T.B(T.Border), BorderThickness = new Thickness(1),
                Effect = new DropShadowEffect { BlurRadius = 18, ShadowDepth = 2, Opacity = 0.55, Color = Colors.Black },
            };
            var root = new Grid { ClipToBounds = true, Clip = new RectangleGeometry(new Rect(0, 0, WinW - 2, WinH - 2), WinR, WinR) };
            outer.Child = root;
            bgLayer = new Grid();
            root.Children.Add(bgLayer);
            canvas = new Canvas { Background = Brushes.Transparent, ClipToBounds = true };
            canvas.MouseLeftButtonDown += delegate (object s, MouseButtonEventArgs e)
            {
                // окно таскается за любое место, кроме кнопок, списков и полей
                for (var d = e.OriginalSource as DependencyObject; d != null && d != canvas; d = VisualTreeHelper.GetParent(d))
                    if (d is FrameworkElement && "i".Equals(((FrameworkElement)d).Tag)) return;
                if (e.ButtonState == MouseButtonState.Pressed) try { DragMove(); } catch { }
            };
            root.Children.Add(canvas);
            overlay = new Grid { Visibility = Visibility.Collapsed, Background = T.B(Colors.Black, 0.6), Tag = "i" };
            root.Children.Add(overlay);
            return outer;
        }

        J ScreenDef(string name) { return T.Layout.O("screens").O(name); }

        public void ShowScreen(string name)
        {
            if (name == "welcome" && !ScreenDef("welcome").B("enabled", true)) name = "mods";
            screen = name;
            var def = ScreenDef(name);
            liveTexts.Clear();
            listScroll = null;
            detailHost = null;
            progress = null;

            // фон экрана: цвет, картинка (своя или общая), размытие, затемнение
            var b = def.O("background");
            var bgc = T.C(b.S("color", "@bg"), "@bg");
            outer.Background = T.B(bgc);
            bgLayer.Children.Clear();
            var bgImg = Img(b.S("image")) ?? Img(T.BgImage);
            if (bgImg != null)
            {
                var img = new Image { Source = bgImg, Stretch = Stretch.UniformToFill };
                var blur = b.N("blur", 6);
                if (blur > 0)
                {
                    img.Effect = new BlurEffect { Radius = blur, KernelType = KernelType.Gaussian };
                    img.RenderTransformOrigin = new Point(0.5, 0.5);
                    img.RenderTransform = new ScaleTransform(1.08, 1.08);
                }
                bgLayer.Children.Add(img);
                bgLayer.Children.Add(new Rectangle { Fill = T.B(bgc, b.N("dim", 0.6)) });
            }

            canvas.Children.Clear();
            foreach (var e in def.A("elements"))
            {
                if (e.B("hidden") || !Visible(e.S("showIf", "always"))) continue;
                FrameworkElement fe;
                try { fe = Build(e); } catch (Exception ex) { Debug.WriteLine(ex); continue; }
                if (fe == null) continue;
                fe.Width = Math.Max(1, e.N("w", 100));
                fe.Height = Math.Max(1, e.N("h", 40));
                fe.Opacity = e.N("opacity", 1);
                Canvas.SetLeft(fe, e.N("x"));
                Canvas.SetTop(fe, e.N("y"));
                canvas.Children.Add(fe);
            }
            if (listScroll != null) FillList();
            if (detailHost != null) ShowDetail(current ?? M.Mods().FirstOrDefault());
            RefreshLive();
            if (T.Animations)
            {
                canvas.Opacity = 0;
                canvas.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(240)));
            }
            else
            {
                canvas.BeginAnimation(OpacityProperty, null);
                canvas.Opacity = 1;
            }
        }

        bool Visible(string cond)
        {
            switch (cond)
            {
                case "updateAvailable": return update != null;
                case "noUpdate": return update == null && M.UpdateType != "none";
                case "hasUpdateSource": return M.UpdateType != "none";
                case "gameFound": return gameVersion != null;
                case "gameMissing": return gameVersion == null;
                case "installed": return installed != null;
                case "notInstalled": return installed == null;
                case "changelog": return M.Changelog.Any(c => !string.IsNullOrWhiteSpace(c.Text));
                case "hasLaunch": return M.LaunchGame && (Mode == "preview" || (gameDir != null && Game.Exe(gameDir) != null));
                case "hasWelcome": return ScreenDef("welcome").B("enabled", true);
                case "hasBanner": return Img(T.Banner) != null;
                default: return true;
            }
        }

        // Подстановки в текстах
        string Fill(string s)
        {
            if (string.IsNullOrEmpty(s) || s.IndexOf('{') < 0) return s ?? "";
            var mods = M.Mods().ToList();
            var sel = mods.Where(n => n.Selected).ToList();
            var map = new Dictionary<string, string>
            {
                { "name", M.Name }, { "version", M.Version }, { "author", M.Author }, { "gameVersion", gameVersion ?? M.GameVersion },
                { "description", T.WelcomeText }, { "welcomeTitle", T.WelcomeTitle }, { "finishTitle", T.FinishTitle },
                { "finishText", Mode == "preview" ? "Это предпросмотр: файлы не устанавливались." : T.FinishText },
                { "modsCount", mods.Count.ToString() }, { "size", Size(mods.Sum(n => n.Size)) },
                { "selected", sel.Count.ToString() }, { "selectedSize", Size(sel.Sum(n => n.Size)) },
                { "game", gameVersion != null ? "Игра: " + gameDir + "  ·  " + gameVersion : "Игра не найдена — укажите папку" },
                { "gamePath", gameDir ?? "" }, { "installedVersion", installed != null ? installed.Version : "—" },
                { "updateVersion", update != null ? update.Version : "" },
            };
            foreach (var kv in map) s = s.Replace("{" + kv.Key + "}", kv.Value ?? "");
            // пустой автор не оставляет висящий разделитель
            return s.Replace("  •    •  ", "  •  ").Trim().TrimEnd('•').Trim();
        }

        void RefreshLive()
        {
            foreach (var kv in liveTexts) kv.Key.Text = Fill(kv.Value);
        }

        FontWeight Weight(string w)
        {
            return w == "bold" ? FontWeights.Bold : w == "semibold" ? FontWeights.SemiBold : w == "light" ? FontWeights.Light : FontWeights.Normal;
        }

        FrameworkElement Build(J e)
        {
            var p = e.O("props");
            switch (e.S("type"))
            {
                case "text":
                    {
                        var raw = p.S("text");
                        var t = new TextBlock
                        {
                            Text = Fill(raw), FontFamily = new FontFamily(T.FontName(p.S("font")) + ", " + T.Font + ", Segoe UI"),
                            FontSize = Math.Max(6, p.N("size", 16)), FontWeight = Weight(p.S("weight")), Foreground = T.B(T.C(p.S("color"), "@text")),
                            TextWrapping = TextWrapping.Wrap, TextTrimming = TextTrimming.CharacterEllipsis,
                            FontStyle = p.B("italic") ? FontStyles.Italic : FontStyles.Normal,
                            TextAlignment = p.S("align") == "center" ? TextAlignment.Center : p.S("align") == "right" ? TextAlignment.Right : TextAlignment.Left,
                            VerticalAlignment = p.S("valign") == "center" ? VerticalAlignment.Center : p.S("valign") == "bottom" ? VerticalAlignment.Bottom : VerticalAlignment.Top,
                        };
                        if (p.N("lineHeight") > 0) t.LineHeight = p.N("lineHeight");
                        if (p.B("shadow")) t.Effect = new DropShadowEffect { BlurRadius = 10, ShadowDepth = 1, Opacity = 0.8, Color = Colors.Black };
                        if (raw.Contains("{")) liveTexts.Add(new KeyValuePair<TextBlock, string>(t, raw));
                        var g = new Grid();
                        g.Children.Add(t);
                        return g;
                    }
                case "image":
                    {
                        var img = Img(p.S("src"));
                        if (img == null) return null;
                        var fit = p.S("fit", "cover");
                        return new Border
                        {
                            CornerRadius = new CornerRadius(Math.Max(0, p.N("radius"))), BorderBrush = T.B(T.C(p.S("border"), "@border")),
                            BorderThickness = new Thickness(p.N("borderWidth")),
                            Background = new ImageBrush(img) { Stretch = fit == "contain" ? Stretch.Uniform : fit == "fill" ? Stretch.Fill : Stretch.UniformToFill },
                        };
                    }
                case "shape":
                    {
                        Brush fill = T.B(T.C(p.S("fill"), "@surface"));
                        if (!string.IsNullOrEmpty(p.S("fill2"))) fill = new LinearGradientBrush(T.C(p.S("fill")), T.C(p.S("fill2")), p.N("angle", 90));
                        var sh = new Border
                        {
                            Background = fill, CornerRadius = new CornerRadius(Math.Max(0, p.N("radius"))),
                            BorderBrush = T.B(T.C(p.S("border"), "@border")), BorderThickness = new Thickness(p.N("borderWidth")),
                        };
                        if (p.B("shadow")) sh.Effect = new DropShadowEffect { BlurRadius = 24, ShadowDepth = 3, Opacity = 0.5, Color = Colors.Black };
                        return sh;
                    }
                case "button":
                    {
                        var raw = p.S("label");
                        var label = new TextBlock
                        {
                            Text = Fill(raw), Foreground = T.B(T.C(p.S("color"), "@accentText")), FontSize = p.N("size", 14), FontWeight = Weight(p.S("weight", "bold")),
                            VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis,
                            FontFamily = new FontFamily(T.FontName(p.S("font")) + ", " + T.Font + ", Segoe UI"),
                        };
                        if (raw.Contains("{")) liveTexts.Add(new KeyValuePair<TextBlock, string>(label, raw));
                        var fillC = T.C(p.S("fill"), "@accent");
                        var b = new Border
                        {
                            Background = T.B(fillC), CornerRadius = new CornerRadius(Math.Max(0, p.N("radius", 9))), Child = label,
                            BorderBrush = T.B(T.C(p.S("border"), "@accent")), BorderThickness = new Thickness(p.N("borderWidth")), Padding = new Thickness(10, 0, 10, 0),
                        };
                        if (p.B("glow") && fillC.A > 0) b.Effect = new DropShadowEffect { Color = fillC, BlurRadius = 18, ShadowDepth = 0, Opacity = 0.35 };
                        var action = p.S("action");
                        var url = p.S("url");
                        Clickable(b, () => Do(action, url));
                        return b;
                    }
                case "modlist": return ModList(p);
                case "moddetail":
                    {
                        var host = new Grid { Tag = "i", Width = e.N("w", 330) };
                        detailHost = host;
                        return host;
                    }
                case "gamecard": return GameCard();
                case "options": return Options(p);
                case "progress": return ProgressWidget();
                case "changelog": return ChangelogWidget();
                case "wincontrols":
                    {
                        var sp = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
                        sp.Children.Add(WinButton("M 0,5 H 10", delegate { WindowState = WindowState.Minimized; }));
                        sp.Children.Add(WinButton("M 0,0 L 10,10 M 10,0 L 0,10", delegate { Close(); }));
                        var g = new Grid();
                        g.Children.Add(sp);
                        return g;
                    }
            }
            return null;
        }

        void Do(string action, string url)
        {
            switch (action)
            {
                case "go:welcome": ShowScreen("welcome"); break;
                case "go:mods": ShowScreen("mods"); break;
                case "install": StartInstall(); break;
                case "installDefaults": ResetDefaults(); StartInstall(); break;
                case "update": ShowUpdate(); break;
                case "checkUpdate": CheckUpdateAsync(true); break;
                case "changelog": ShowChangelog(); break;
                case "pickFolder": PickFolder(); break;
                case "launchGame":
                    {
                        var exe = gameDir == null ? null : Game.Exe(gameDir);
                        if (exe != null && Mode != "preview") Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = gameDir, UseShellExecute = true });
                        Close();
                        break;
                    }
                case "openFolder": if (gameDir != null) Process.Start("explorer.exe", "\"" + gameDir + "\""); break;
                case "url":
                    if (!string.IsNullOrEmpty(url) && (url.StartsWith("https://") || url.StartsWith("http://")))
                        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                    break;
                case "uninstall": ConfirmUninstall(); break;
                case "minimize": WindowState = WindowState.Minimized; break;
                case "close": Close(); break;
            }
        }

        // ---------- виджеты ----------

        FrameworkElement GameCard()
        {
            var sp = new StackPanel();
            var row = new StackPanel { Orientation = Orientation.Horizontal };
            row.Children.Add(new Ellipse { Width = 10, Height = 10, Fill = T.B(gameVersion != null ? T.Success : T.Danger), Margin = new Thickness(0, 0, 9, 0) });
            row.Children.Add(Text(gameVersion != null ? "Игра найдена · " + gameVersion : "Игра не найдена", 14, FontWeights.Bold));
            sp.Children.Add(row);
            var path = Text(gameDir ?? "Укажите папку, где установлен «Мир танков»", 12, null, T.Muted, true);
            path.Margin = new Thickness(0, 6, 0, 10);
            sp.Children.Add(path);
            if (gameVersion != null && !string.IsNullOrEmpty(M.GameVersion) && !gameVersion.StartsWith(M.GameVersion))
            {
                var w = Text("Модпак собран для версии " + M.GameVersion + " — часть модов может не работать.", 12, null, T.Accent, true);
                w.Margin = new Thickness(0, 0, 0, 10);
                sp.Children.Add(w);
            }
            if (installed != null && Mode != "manage")
            {
                var i = Text("Уже установлена версия " + installed.Version + " — она будет заменена.", 12, null, T.Muted, true);
                i.Margin = new Thickness(0, 0, 0, 10);
                sp.Children.Add(i);
            }
            var b = Button(gameVersion != null ? "Изменить папку" : "Указать папку", "default", PickFolder, 32);
            b.HorizontalAlignment = HorizontalAlignment.Left;
            sp.Children.Add(b);
            return Box(sp);
        }

        FrameworkElement Options(J p)
        {
            var left = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            if (p.B("game", true))
            {
                var gameRow = new StackPanel { Orientation = Orientation.Horizontal };
                gameRow.Children.Add(new Ellipse { Width = 9, Height = 9, Fill = T.B(gameVersion != null ? T.Success : T.Danger), Margin = new Thickness(0, 0, 8, 0) });
                gameRow.Children.Add(Text(gameVersion != null ? gameDir + "  ·  " + gameVersion : "Игра не найдена — нажмите, чтобы указать папку", 12.5, FontWeights.SemiBold));
                gameRow.Children.Add(Text("  Изменить", 12.5, FontWeights.SemiBold, T.Accent));
                Clickable(gameRow, PickFolder);
                left.Children.Add(gameRow);
            }
            var opts = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 9, 0, 0) };
            if (p.B("clean", true)) opts.Children.Add(Toggle("Убрать старые моды (в бэкап)", cleanOld, v => cleanOld = v));
            if (p.B("shortcut", true)) opts.Children.Add(Toggle("Ярлык на рабочем столе", shortcut, v => shortcut = v));
            if (opts.Children.Count > 0) left.Children.Add(opts);
            var g = new Grid();
            g.Children.Add(left);
            return g;
        }

        FrameworkElement ChangelogWidget()
        {
            var latest = M.Changelog.FirstOrDefault(c => !string.IsNullOrWhiteSpace(c.Text));
            var g = new Grid();
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            g.Children.Add(Text(latest != null ? "Что нового в версии " + latest.Version : "Что нового", 15, FontWeights.Bold));
            var t = Text(latest != null ? latest.Text : "", 13, null, T.Text, true);
            t.Opacity = 0.85;
            var sv = new ScrollViewer { Content = t, Margin = new Thickness(0, 8, 0, 0), VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Tag = "i" };
            Grid.SetRow(sv, 1);
            g.Children.Add(sv);
            return Box(g);
        }

        FrameworkElement ProgressWidget()
        {
            var sp = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            var cur = Text("Подготовка…", 13, null, T.Muted);
            cur.Margin = new Thickness(0, 0, 0, 14);
            sp.Children.Add(cur);
            var track = new Border { Height = 12, CornerRadius = new CornerRadius(6), Background = T.B(T.Card), BorderBrush = T.B(T.Border), BorderThickness = new Thickness(1) };
            var fill = new Border
            {
                CornerRadius = new CornerRadius(6), HorizontalAlignment = HorizontalAlignment.Left, Width = 0,
                Background = new LinearGradientBrush(T.Accent, Color.FromArgb(255, (byte)Math.Min(255, T.Accent.R + 40), (byte)Math.Min(255, T.Accent.G + 40), (byte)Math.Min(255, T.Accent.B + 40)), 0),
                Effect = new DropShadowEffect { Color = T.Accent, BlurRadius = 14, ShadowDepth = 0, Opacity = 0.5 },
            };
            track.Child = fill;
            sp.Children.Add(track);
            var pct = Text("0%", 13, FontWeights.Bold, T.Accent);
            pct.Margin = new Thickness(0, 10, 0, 0);
            pct.HorizontalAlignment = HorizontalAlignment.Right;
            sp.Children.Add(pct);
            progress = (p, s) =>
            {
                var w = Math.Max(0, (track.ActualWidth - 2) * p);
                if (T.Animations) fill.BeginAnimation(WidthProperty, new DoubleAnimation(w, TimeSpan.FromMilliseconds(180)));
                else fill.Width = w;
                pct.Text = (int)(p * 100) + "%";
                cur.Text = s;
            };
            var g = new Grid();
            g.Children.Add(sp);
            return g;
        }

        // --- список модов ---

        FrameworkElement ModList(J p)
        {
            listProps = p;
            var g = new Grid { Tag = "i" };
            var sidebar = p.S("categories") == "sidebar";
            var tabs = p.S("categories", "tabs") == "tabs";
            if (sidebar)
            {
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(180) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            }
            var cats = new List<KeyValuePair<string, string>> { new KeyValuePair<string, string>("all", "Все моды") };
            foreach (var n in M.Tree.Where(n => n.IsGroup && n.Mods().Any())) cats.Add(new KeyValuePair<string, string>(n.Id, n.Name));
            if (M.Tree.Any(n => !n.IsGroup) && M.Tree.Any(n => n.IsGroup)) cats.Add(new KeyValuePair<string, string>("other", "Отдельные моды"));
            cats.Add(new KeyValuePair<string, string>("selected", "Выбранные"));

            var main = new Grid();
            main.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            main.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            var top = new DockPanel { Margin = new Thickness(0, 0, 0, 12), LastChildFill = true };
            if (p.B("search", true))
            {
                var search = new TextBox
                {
                    Width = 210, Height = 36, Padding = new Thickness(10, 0, 10, 0), VerticalContentAlignment = VerticalAlignment.Center,
                    Background = Brushes.Transparent, Foreground = T.B(T.Text), CaretBrush = T.B(T.Text), BorderThickness = new Thickness(0), Text = query,
                };
                var hint = Text("Поиск модов…", 0, null, T.Muted);
                hint.IsHitTestVisible = false;
                hint.Margin = new Thickness(12, 0, 0, 0);
                hint.VerticalAlignment = VerticalAlignment.Center;
                hint.Visibility = string.IsNullOrEmpty(query) ? Visibility.Visible : Visibility.Collapsed;
                var sg = new Grid();
                sg.Children.Add(search);
                sg.Children.Add(hint);
                var sbox = new Border
                {
                    CornerRadius = R(0.75), Background = T.B(T.Card, T.SurfaceOpacity), BorderBrush = T.B(T.Border), BorderThickness = new Thickness(1),
                    Child = sg, VerticalAlignment = VerticalAlignment.Top, Height = 38, Margin = new Thickness(12, 0, 0, 0),
                };
                DockPanel.SetDock(sbox, Dock.Right);
                top.Children.Add(sbox);
                search.TextChanged += delegate
                {
                    query = search.Text;
                    hint.Visibility = string.IsNullOrEmpty(query) ? Visibility.Visible : Visibility.Collapsed;
                    FillList();
                };
            }
            if (tabs)
            {
                var wp = new WrapPanel { VerticalAlignment = VerticalAlignment.Center };
                foreach (var c in cats) wp.Children.Add(CategoryChip(c.Key, c.Value, false));
                top.Children.Add(wp);
            }
            else top.Children.Add(new Border());
            main.Children.Add(top);
            listScroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Padding = new Thickness(0, 0, 6, 0) };
            Grid.SetRow(listScroll, 1);
            main.Children.Add(listScroll);
            if (sidebar)
            {
                var nav = new StackPanel();
                foreach (var c in cats) nav.Children.Add(CategoryChip(c.Key, c.Value, true));
                var np = Box(nav, new Thickness(8));
                np.Margin = new Thickness(0, 0, 14, 0);
                g.Children.Add(np);
                Grid.SetColumn(main, 1);
            }
            g.Children.Add(main);
            return g;
        }

        Border CategoryChip(string key, string label, bool vertical)
        {
            var on = category == key;
            var count = key == "all" ? M.Mods().Count() : key == "selected" ? M.Mods().Count(n => n.Selected)
                : key == "other" ? M.Tree.Count(n => !n.IsGroup) : M.Tree.First(n => n.Id == key).Mods().Count();
            var sp = new DockPanel();
            var c = Text(count.ToString(), 11, FontWeights.Bold, on ? T.AccentText : T.Muted);
            c.Margin = new Thickness(8, 0, 0, 0);
            DockPanel.SetDock(c, Dock.Right);
            sp.Children.Add(c);
            sp.Children.Add(Text(label, 13, FontWeights.SemiBold, on ? T.AccentText : T.Text));
            var b = new Border
            {
                CornerRadius = vertical ? R(0.6) : new CornerRadius(18), Padding = new Thickness(14, 7, 12, 7),
                Margin = vertical ? new Thickness(0, 0, 0, 4) : new Thickness(0, 0, 8, 8),
                Background = on ? T.B(T.Accent) : (vertical ? Brushes.Transparent : T.B(T.Card, T.SurfaceOpacity)),
                BorderBrush = on ? T.B(T.Accent) : T.B(T.Border), BorderThickness = new Thickness(vertical ? 0 : 1), Child = sp,
            };
            Clickable(b, delegate { category = key; ShowScreen(screen); });
            return b;
        }

        IEnumerable<Node> Matches(IEnumerable<Node> nodes)
        {
            var q = (query ?? "").Trim().ToLowerInvariant();
            return nodes.Where(n => !n.IsGroup && (q.Length == 0 || (n.Name + " " + n.Description + " " + n.Author).ToLowerInvariant().Contains(q)));
        }

        void FillList()
        {
            if (listScroll == null) return;
            var listLayout = listProps.S("layout", "grid");
            var sp = new StackPanel();
            Action<string, string, IEnumerable<Node>> section = delegate (string title, string hint, IEnumerable<Node> mods)
            {
                var list = Matches(mods).ToList();
                if (list.Count == 0) return;
                if (title != null)
                {
                    var h = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(2, sp.Children.Count == 0 ? 0 : 10, 0, 10) };
                    h.Children.Add(Text(title, 16, FontWeights.Bold, null, false, true));
                    if (hint != null)
                    {
                        var ht = Text(hint, 12, null, T.Accent);
                        ht.Margin = new Thickness(10, 3, 0, 0);
                        h.Children.Add(ht);
                    }
                    sp.Children.Add(h);
                }
                Panel wrap = listLayout == "list" ? (Panel)new StackPanel() : new WrapPanel();
                foreach (var n in list) wrap.Children.Add(listLayout == "list" ? ModRow(n) : ModCard(n));
                sp.Children.Add(wrap);
            };
            Action<Node> groupSections = null;
            groupSections = delegate (Node grp)
            {
                section(grp.Path.Length > 0 ? grp.Path + " › " + grp.Name : grp.Name, grp.Mode == "single" ? "выберите один вариант" : null, grp.Children.Where(c => !c.IsGroup));
                foreach (var c in grp.Children.Where(c => c.IsGroup)) groupSections(c);
            };
            if (category == "selected") section(null, null, M.Mods().Where(n => n.Selected));
            else if (category == "other") section(null, null, M.Tree.Where(n => !n.IsGroup));
            else if (category == "all")
            {
                foreach (var n in M.Tree.Where(n => n.IsGroup)) groupSections(n);
                section(M.Tree.Any(n => n.IsGroup) ? "Отдельные моды" : null, null, M.Tree.Where(n => !n.IsGroup));
            }
            else if (M.Tree.Any(n => n.Id == category)) groupSections(M.Tree.First(n => n.Id == category));
            if (sp.Children.Count == 0)
            {
                var e = Text(string.IsNullOrEmpty(query) ? "Здесь пока пусто" : "Ничего не найдено", 15, null, T.Muted);
                e.HorizontalAlignment = HorizontalAlignment.Center;
                e.Margin = new Thickness(0, 60, 0, 0);
                sp.Children.Add(e);
            }
            listScroll.Content = sp;
        }

        void Toggle(Node n)
        {
            if (n.IsRadio)
            {
                var was = n.Selected;
                foreach (var s in n.Parent.Children.Where(c => !c.IsGroup)) s.Selected = false;
                n.Selected = !was;
            }
            else n.Selected = !n.Selected;
            current = n;
            FillListKeep();
            if (detailHost != null) ShowDetail(n);
            RefreshLive();
        }

        void FillListKeep()
        {
            if (listScroll == null) return;
            var off = listScroll.VerticalOffset;
            FillList();
            listScroll.ScrollToVerticalOffset(off);
        }

        UIElement ModCard(Node n)
        {
            var size = listProps.S("cardSize", "m");
            double w = size == "s" ? 168 : size == "l" ? 262 : 210;
            var on = n.Selected;
            var card = new Border
            {
                Width = w, Margin = new Thickness(0, 0, 12, 12), CornerRadius = R(), Cursor = Cursors.Hand,
                Background = T.B(T.Card, T.SurfaceOpacity), BorderThickness = new Thickness(on ? 2 : 1),
                BorderBrush = on ? T.B(T.Accent) : (n == current ? T.B(T.Text, 0.4) : T.B(T.Border)),
            };
            if (on) card.Effect = new DropShadowEffect { Color = T.Accent, BlurRadius = 16, ShadowDepth = 0, Opacity = 0.3 };
            var g = new Grid();
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(w * 9 / 16) });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var img = Img(n.Image);
            g.Children.Add(new Border { CornerRadius = new CornerRadius(Math.Max(0, T.Radius - 1), Math.Max(0, T.Radius - 1), 0, 0),
                Background = img != null ? (Brush)new ImageBrush(img) { Stretch = Stretch.UniformToFill } : T.B(T.Surface) });
            var ind = Indicator(n.IsRadio, on);
            ind.HorizontalAlignment = HorizontalAlignment.Right;
            ind.VerticalAlignment = VerticalAlignment.Top;
            ind.Margin = new Thickness(0, 8, 8, 0);
            g.Children.Add(ind);
            var txt = new StackPanel { Margin = new Thickness(12, 9, 12, 11) };
            txt.Children.Add(Text(n.Name, 13.5, FontWeights.Bold));
            txt.Children.Add(Text((string.IsNullOrEmpty(n.Version) ? "" : "v" + n.Version + "  ·  ") + Size(n.Size), 11.5, null, T.Muted));
            Grid.SetRow(txt, 1);
            g.Children.Add(txt);
            card.Child = g;
            if (T.Animations)
            {
                var tr = new TranslateTransform();
                card.RenderTransform = tr;
                card.MouseEnter += delegate { tr.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(-3, TimeSpan.FromMilliseconds(140))); };
                card.MouseLeave += delegate { tr.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, TimeSpan.FromMilliseconds(160))); };
            }
            card.MouseLeftButtonUp += delegate (object s, MouseButtonEventArgs e)
            {
                // клик по картинке — показать описание, по остальной карточке — выбрать
                if (e.GetPosition(card).Y < w * 9 / 16 && e.GetPosition(card).X < w - 44 && current != n && detailHost != null)
                {
                    current = n;
                    ShowDetail(n);
                    FillListKeep();
                }
                else Toggle(n);
            };
            return card;
        }

        UIElement ModRow(Node n)
        {
            var on = n.Selected;
            var row = new Border
            {
                Margin = new Thickness(0, 0, 0, 8), CornerRadius = R(0.75), Cursor = Cursors.Hand, Padding = new Thickness(10),
                Background = T.B(T.Card, T.SurfaceOpacity), BorderThickness = new Thickness(on ? 2 : 1),
                BorderBrush = on ? T.B(T.Accent) : (n == current ? T.B(T.Text, 0.4) : T.B(T.Border)),
            };
            var g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var ind = Indicator(n.IsRadio, on);
            ind.VerticalAlignment = VerticalAlignment.Center;
            g.Children.Add(ind);
            var img = Img(n.Image);
            var pic = new Border { Width = 96, Height = 54, CornerRadius = R(0.5), Margin = new Thickness(12, 0, 12, 0),
                Background = img != null ? (Brush)new ImageBrush(img) { Stretch = Stretch.UniformToFill } : T.B(T.Surface) };
            Grid.SetColumn(pic, 1);
            g.Children.Add(pic);
            var txt = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            txt.Children.Add(Text(n.Name, 14, FontWeights.Bold));
            txt.Children.Add(Text((n.Description ?? "").Split('\n')[0], 12, null, T.Muted));
            Grid.SetColumn(txt, 2);
            g.Children.Add(txt);
            var sz = Text(Size(n.Size), 12, null, T.Muted);
            sz.VerticalAlignment = VerticalAlignment.Center;
            sz.Margin = new Thickness(12, 0, 4, 0);
            Grid.SetColumn(sz, 3);
            g.Children.Add(sz);
            row.Child = g;
            row.MouseLeftButtonUp += delegate { Toggle(n); };
            return row;
        }

        void ShowDetail(Node n)
        {
            if (detailHost == null) return;
            detailHost.Children.Clear();
            if (n == null) return;
            current = n;
            var g = new Grid();
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var img = Img(n.Image);
            var w = ((FrameworkElement)detailHost).Width;
            if (double.IsNaN(w) || w <= 0) w = 330;
            g.Children.Add(new Border { Height = (w - 2) * 9 / 16, CornerRadius = new CornerRadius(Math.Max(0, T.Radius - 1), Math.Max(0, T.Radius - 1), 0, 0),
                Background = img != null ? (Brush)new ImageBrush(img) { Stretch = Stretch.UniformToFill } : T.B(T.Card) });
            var head = new StackPanel { Margin = new Thickness(18, 14, 18, 6) };
            if (n.Parent != null) head.Children.Add(Text(n.Path.ToUpperInvariant(), 10.5, FontWeights.Bold, T.Accent));
            head.Children.Add(Text(n.Name, 19, FontWeights.Bold, null, true, true));
            var meta = new List<string>();
            if (!string.IsNullOrEmpty(n.Version)) meta.Add("Версия " + n.Version);
            if (!string.IsNullOrEmpty(n.Author)) meta.Add(n.Author);
            meta.Add(Size(n.Size));
            head.Children.Add(Text(string.Join("  ·  ", meta), 12, null, T.Muted));
            Grid.SetRow(head, 1);
            g.Children.Add(head);
            var desc = Text(string.IsNullOrWhiteSpace(n.Description) ? "Описание не указано." : n.Description, 13, null, T.Text, true);
            desc.Opacity = 0.88;
            desc.LineHeight = 20;
            var sv = new ScrollViewer { Content = desc, Padding = new Thickness(18, 4, 14, 8), VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            Grid.SetRow(sv, 2);
            g.Children.Add(sv);
            var btn = Button(n.Selected ? (n.IsRadio ? "Выбран  ✓" : "В наборе  ✓") : (n.IsRadio ? "Выбрать этот вариант" : "Добавить в набор"),
                n.Selected ? "default" : "primary", delegate { Toggle(n); }, 42);
            btn.Margin = new Thickness(16, 6, 16, 16);
            Grid.SetRow(btn, 3);
            g.Children.Add(btn);
            detailHost.Children.Add(Box(g, new Thickness(0)));
        }

        void PickFolder()
        {
            using (var d = new System.Windows.Forms.FolderBrowserDialog { Description = "Папка, где установлен «Мир танков»", ShowNewFolderButton = false })
            {
                if (gameDir != null) d.SelectedPath = gameDir;
                if (d.ShowDialog() != System.Windows.Forms.DialogResult.OK) return;
                if (Game.ReadVersion(d.SelectedPath) == null)
                {
                    Alert("Это не папка игры", "В выбранной папке нет файла version.xml. Укажите папку, где установлен «Мир танков».");
                    return;
                }
                gameDir = d.SelectedPath.TrimEnd('\\');
                RefreshGame();
                ShowScreen(screen);
            }
        }

        void ResetDefaults()
        {
            foreach (var n in M.Mods()) n.Selected = n.Checked;
            foreach (var g in M.All().Where(n => n.IsGroup && n.Mode == "single"))
            {
                var first = g.Children.FirstOrDefault(c => !c.IsGroup && c.Selected);
                foreach (var c in g.Children.Where(c => !c.IsGroup)) c.Selected = c == first;
            }
        }

        // ---------- установка ----------

        void StartInstall()
        {
            if (Mode == "preview") { ProgressDemo(); return; }
            if (gameVersion == null) { Alert("Игра не найдена", "Укажите папку, где установлен «Мир танков»."); PickFolder(); return; }
            if (!M.Mods().Any(n => n.Selected)) { Alert("Ничего не выбрано", "Отметьте хотя бы один мод."); return; }
            if (Process.GetProcessesByName("WorldOfTanks").Any())
            {
                Alert("Игра запущена", "Закройте «Мир танков» перед установкой модов, иначе файлы могут не замениться.");
                return;
            }
            ShowScreen("progress");
            var engine = new Engine(M);
            engine.Progress = (p, s) => Dispatcher.BeginInvoke(new Action(() => { if (progress != null) progress(p, s); }));
            var dir = gameDir;
            bool clean = cleanOld, sc = shortcut;
            Task.Factory.StartNew(() => engine.Install(dir, clean, sc)).ContinueWith(t => Dispatcher.BeginInvoke(new Action(() =>
            {
                if (t.IsFaulted)
                {
                    var ex = t.Exception.GetBaseException();
                    ShowScreen("mods");
                    Alert("Не удалось установить", ex is UnauthorizedAccessException
                        ? "Нет прав на запись в папку игры. Запустите установщик от имени администратора (правой кнопкой → «Запуск от имени администратора»)."
                        : ex.Message);
                }
                else
                {
                    RefreshGame();
                    ShowScreen("finish");
                }
            })));
        }

        void ProgressDemo()
        {
            ShowScreen("progress");
            var mods = M.Mods().Where(n => n.Selected).Select(n => n.Name).DefaultIfEmpty("Моды").ToList();
            var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(60) };
            double p = 0;
            timer.Tick += delegate
            {
                p += 0.02;
                if (progress != null) progress(Math.Min(1, p), "Предпросмотр: " + mods[(int)(Math.Min(0.999, p) * mods.Count)]);
                if (p >= 1) { timer.Stop(); ShowScreen("finish"); }
            };
            timer.Start();
        }

        void ConfirmUninstall()
        {
            Modal("Удалить модпак?", "Файлы модпака будут удалены из игры, заменённые файлы вернутся из резервной копии.", "Удалить", "danger", delegate
            {
                var dir = gameDir;
                Task.Factory.StartNew(() => new Engine(M).Uninstall(dir)).ContinueWith(t => Dispatcher.BeginInvoke(new Action(() =>
                {
                    if (t.IsFaulted) Alert("Ошибка удаления", t.Exception.GetBaseException().Message);
                    else
                    {
                        installed = null;
                        Modal("Модпак удалён", "Файлы модпака удалены, заменённые файлы игры восстановлены.", "Закрыть", "primary", Close);
                    }
                })));
            });
        }

        // ---------- обновление модпака ----------

        void CheckUpdateAsync(bool manual = false)
        {
            if (M.UpdateType == "none" || Mode == "preview") return;
            Task.Factory.StartNew(() => Updater.Check(M)).ContinueWith(t => Dispatcher.BeginInvoke(new Action(() =>
            {
                if (t.IsFaulted) { if (manual) Alert("Не удалось проверить", t.Exception.GetBaseException().Message); return; }
                var was = update;
                update = t.Result;
                if (update == null && manual) Alert("Обновлений нет", "У вас последняя версия модпака.");
                if ((was == null) != (update == null) && screen != "progress") ShowScreen(screen);
            })));
        }

        void ShowUpdate()
        {
            if (update == null) return;
            Modal("Доступна версия " + update.Version, string.IsNullOrWhiteSpace(update.Notes) ? "Автор не описал изменения." : update.Notes,
                "Скачать и установить" + (update.Size > 0 ? " (" + Size(update.Size) + ")" : ""), "primary", DownloadUpdate);
        }

        void DownloadUpdate()
        {
            var sp = new StackPanel { Width = 420 };
            sp.Children.Add(Text("Скачиваю обновление…", 18, FontWeights.Bold));
            var track = new Border { Height = 10, CornerRadius = new CornerRadius(5), Background = T.B(T.Card), Margin = new Thickness(0, 16, 0, 8) };
            var fill = new Border { CornerRadius = new CornerRadius(5), HorizontalAlignment = HorizontalAlignment.Left, Width = 0, Background = T.B(T.Accent) };
            track.Child = fill;
            sp.Children.Add(track);
            var info = Text("", 12, null, T.Muted);
            sp.Children.Add(info);
            ShowOverlay(Box(sp, new Thickness(24)));
            var u = update;
            Task.Factory.StartNew(() => Updater.Download(u, (got, total) => Dispatcher.BeginInvoke(new Action(() =>
            {
                if (total > 0) fill.Width = track.ActualWidth * got / total;
                info.Text = Size(got) + (total > 0 ? " из " + Size(total) : "");
            })))).ContinueWith(t => Dispatcher.BeginInvoke(new Action(() =>
            {
                if (t.IsFaulted) { HideOverlay(); Alert("Обновление не скачалось", t.Exception.GetBaseException().Message); return; }
                Process.Start(new ProcessStartInfo(t.Result) { UseShellExecute = true, Arguments = gameDir != null ? "--dir=\"" + gameDir + "\"" : "" });
                Close();
            })));
        }

        void ShowChangelog()
        {
            var text = string.Join("\n\n", M.Changelog.Where(c => !string.IsNullOrWhiteSpace(c.Text)).Take(5).Select(c => "Версия " + c.Version + "\n" + c.Text.Trim()));
            Modal("Что нового", string.IsNullOrEmpty(text) ? "Автор пока не описал изменения." : text, null, null, null);
        }

        // ---------- окна поверх ----------

        void ShowOverlay(UIElement content)
        {
            overlay.Children.Clear();
            var fe = content as FrameworkElement;
            if (fe != null) { fe.HorizontalAlignment = HorizontalAlignment.Center; fe.VerticalAlignment = VerticalAlignment.Center; }
            overlay.Children.Add(content);
            overlay.Visibility = Visibility.Visible;
            if (T.Animations) overlay.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(160)));
        }

        void HideOverlay() { overlay.Visibility = Visibility.Collapsed; overlay.Children.Clear(); }

        void Alert(string title, string text) { Modal(title, text, null, null, null); }

        void Modal(string title, string text, string okText, string okKind, Action ok)
        {
            var sp = new StackPanel { Width = 480 };
            sp.Children.Add(Text(title, 20, FontWeights.Bold, null, true, true));
            var t = Text(text, 13.5, null, T.Text, true);
            t.Opacity = 0.88;
            t.LineHeight = 20;
            sp.Children.Add(new ScrollViewer { Content = t, MaxHeight = 320, Margin = new Thickness(0, 10, 0, 20), VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
            var btns = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            btns.Children.Add(Button(ok == null ? "Понятно" : "Отмена", ok == null ? "primary" : "ghost", HideOverlay, 40));
            if (ok != null)
            {
                var b = Button(okText, okKind, delegate { HideOverlay(); ok(); }, 40);
                b.Margin = new Thickness(8, 0, 0, 0);
                btns.Children.Add(b);
            }
            sp.Children.Add(btns);
            ShowOverlay(Box(sp, new Thickness(26)));
        }

        // ---------- снимок окна без показа на экране (предпросмотр в конструкторе и тесты) ----------

        public void Snapshot(string file, string screenName)
        {
            T.Animations = false;
            if (screenName == "changelog") { ShowScreen("welcome"); ShowChangelog(); }
            else ShowScreen(screenName);
            if (screenName == "progress")
                Dispatcher.BeginInvoke(new Action(() => { if (progress != null) progress(0.62, "Лампа «Шестое чувство»"); }), System.Windows.Threading.DispatcherPriority.Loaded);
            Left = -20000;
            Top = -20000;
            ShowActivated = false;
            ShowInTaskbar = false;
            Show();
            Dispatcher.BeginInvoke(new Action(() =>
            {
                var rtb = new RenderTargetBitmap((int)ActualWidth, (int)ActualHeight, 96, 96, PixelFormats.Pbgra32);
                rtb.Render(this);
                var enc = new PngBitmapEncoder();
                enc.Frames.Add(BitmapFrame.Create(rtb));
                using (var fs = File.Create(file)) enc.Save(fs);
                Application.Current.Shutdown();
            }), System.Windows.Threading.DispatcherPriority.ApplicationIdle);
        }
    }
}
