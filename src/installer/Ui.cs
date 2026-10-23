// Интерфейс установщика. Всё оформление — из темы автора (manifest.theme): цвета, фон, шрифты,
// скругления, раскладка карточек, навигация, размер окна и тексты.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
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
        public Color Bg, Surface, Card, Border, Text, Muted, Accent, AccentText, Danger, Success;
        public string BgImage, Banner, Logo, Font, TitleFont, Layout, CardSize, Nav;
        public double BgDim, BgBlur, Radius, FontSize, SurfaceOpacity, Width, Height;
        public bool Animations, WelcomeScreen;
        public string WelcomeTitle, WelcomeText, InstallText, FinishTitle, FinishText;

        public static Color C(string s, string def)
        {
            try { return (Color)ColorConverter.ConvertFromString(string.IsNullOrEmpty(s) ? def : s); }
            catch { return (Color)ColorConverter.ConvertFromString(def); }
        }

        public static Theme From(J t, Manifest m)
        {
            var c = t.O("colors");
            var x = t.O("texts");
            return new Theme
            {
                Bg = C(c.S("bg"), "#0F1115"), Surface = C(c.S("surface"), "#181B21"), Card = C(c.S("card"), "#1F232B"),
                Border = C(c.S("border"), "#2C313B"), Text = C(c.S("text"), "#EEE9DF"), Muted = C(c.S("muted"), "#8F8A80"),
                Accent = C(c.S("accent"), "#F0A53A"), AccentText = C(c.S("accentText"), "#1D1305"),
                Danger = C(c.S("danger"), "#EF5D55"), Success = C(c.S("success"), "#5CC98A"),
                BgImage = t.S("bgImage"), Banner = t.S("banner"), Logo = t.S("logo"),
                Font = t.S("font", "Segoe UI"), TitleFont = t.S("titleFont", t.S("font", "Segoe UI")),
                Layout = t.S("layout", "grid"), CardSize = t.S("cardSize", "m"), Nav = t.S("nav", "tabs"),
                BgDim = t.N("bgDim", 0.55), BgBlur = t.N("bgBlur", 0), Radius = t.N("radius", 12), FontSize = t.N("fontSize", 13),
                SurfaceOpacity = t.N("surfaceOpacity", 0.92), Width = t.N("width", 1100), Height = t.N("height", 700),
                Animations = t.B("animations", true), WelcomeScreen = t.B("welcomeScreen", true),
                WelcomeTitle = Or(x.S("welcomeTitle"), m.Name), WelcomeText = Or(x.S("welcomeText"), m.Description),
                InstallText = Or(x.S("installButton"), "Установить"), FinishTitle = Or(x.S("finishTitle"), "Готово!"),
                FinishText = Or(x.S("finishText"), "Модпак «" + m.Name + "» установлен. Можно запускать игру!"),
            };
        }

        static string Or(string s, string def) { return string.IsNullOrWhiteSpace(s) ? def : s; }

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
        Grid body, footer, overlay;
        Border updateBtn;
        UpdateInfo update;
        string gameDir, gameVersion;
        InstallRecord installed;
        Node current;
        string category = "all", query = "";
        bool cleanOld, shortcut = true;
        ScrollViewer listScroll;
        Panel detailHost;

        public MainWindow(Manifest m, string mode, string gameDirArg)
        {
            M = m;
            Mode = mode;
            T = Theme.From(m.Theme, m);
            cleanOld = m.CleanDefault;
            Title = m.Name;
            Width = T.Width + 24;
            Height = T.Height + 24;
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
            if (Mode == "manage") ShowManage();
            else if (T.WelcomeScreen) ShowWelcome();
            else ShowMods();
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

        // ---------- оформление ----------

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

        CornerRadius R(double k = 1) { return new CornerRadius(T.Radius * k); }

        TextBlock Text(string s, double size = 0, FontWeight? w = null, Color? color = null, bool wrap = false, bool title = false)
        {
            var t = new TextBlock { Text = s ?? "", FontSize = size > 0 ? size : T.FontSize, Foreground = T.B(color ?? T.Text) };
            if (w.HasValue) t.FontWeight = w.Value;
            if (title) t.FontFamily = new FontFamily(T.TitleFont + ", " + T.Font + ", Segoe UI");
            if (wrap) t.TextWrapping = TextWrapping.Wrap; else t.TextTrimming = TextTrimming.CharacterEllipsis;
            return t;
        }

        // Кнопка: kind = primary | ghost | outline | danger
        Border Button(string text, string kind, Action click, double height = 40)
        {
            var fg = kind == "primary" ? T.AccentText : kind == "danger" ? T.Danger : T.Text;
            var bg = kind == "primary" ? T.B(T.Accent) : kind == "ghost" ? Brushes.Transparent : T.B(T.Card, T.SurfaceOpacity);
            var b = new Border
            {
                CornerRadius = R(0.75), Height = height, Padding = new Thickness(height > 36 ? 20 : 12, 0, height > 36 ? 20 : 12, 0),
                Background = bg, Cursor = Cursors.Hand,
                BorderBrush = kind == "outline" ? T.B(T.Accent) : kind == "danger" ? T.B(T.Danger, 0.6) : kind == "primary" ? T.B(T.Accent) : T.B(T.Border),
                BorderThickness = new Thickness(kind == "ghost" ? 0 : 1),
                Child = new TextBlock
                {
                    Text = text, Foreground = T.B(fg), FontWeight = kind == "primary" ? FontWeights.Bold : FontWeights.SemiBold,
                    VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center,
                },
            };
            if (kind == "primary") b.Effect = new DropShadowEffect { Color = T.Accent, BlurRadius = 18, ShadowDepth = 0, Opacity = 0.35 };
            b.MouseEnter += delegate { b.Opacity = 0.88; };
            b.MouseLeave += delegate { b.Opacity = 1; };
            b.MouseLeftButtonUp += delegate (object s, MouseButtonEventArgs e) { e.Handled = true; click(); };
            return b;
        }

        Border Box(UIElement child, Thickness? pad = null)
        {
            return new Border
            {
                Background = T.B(T.Surface, T.SurfaceOpacity), CornerRadius = R(), BorderBrush = T.B(T.Border), BorderThickness = new Thickness(1),
                Padding = pad ?? new Thickness(18), Child = child,
            };
        }

        // Квадрат-галочка или круг для радиокнопки
        FrameworkElement Indicator(bool radio, bool on, double size = 22)
        {
            var g = new Grid { Width = size, Height = size };
            var box = new Border
            {
                CornerRadius = new CornerRadius(radio ? size / 2 : 6), BorderThickness = new Thickness(2),
                BorderBrush = on ? T.B(T.Accent) : T.B(T.Text, 0.55), Background = on ? T.B(T.Accent) : T.B(Colors.Black, 0.35),
            };
            g.Children.Add(box);
            if (on)
            {
                if (radio)
                    g.Children.Add(new Ellipse { Width = size * 0.36, Height = size * 0.36, Fill = T.B(T.AccentText) });
                else
                    g.Children.Add(new Path
                    {
                        Data = Geometry.Parse("M 5,11 L 9,15 L 17,7"), Stroke = T.B(T.AccentText), StrokeThickness = 2.6,
                        StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, Width = size, Height = size,
                        Stretch = Stretch.None, Margin = new Thickness((size - 22) / 2, (size - 22) / 2, 0, 0),
                    });
            }
            return g;
        }

        // Тумблер с подписью
        FrameworkElement Toggle(string label, bool value, Action<bool> changed)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal, Cursor = Cursors.Hand, Margin = new Thickness(0, 0, 18, 0) };
            var track = new Border { Width = 36, Height = 20, CornerRadius = new CornerRadius(10), VerticalAlignment = VerticalAlignment.Center };
            var knob = new Ellipse { Width = 14, Height = 14, HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(3, 0, 3, 0) };
            track.Child = knob;
            Action paint = delegate
            {
                track.Background = value ? T.B(T.Accent) : T.B(T.Card);
                track.BorderBrush = value ? T.B(T.Accent) : T.B(T.Border);
                track.BorderThickness = new Thickness(1);
                knob.Fill = value ? T.B(T.AccentText) : T.B(T.Muted);
                knob.HorizontalAlignment = value ? HorizontalAlignment.Right : HorizontalAlignment.Left;
            };
            paint();
            sp.Children.Add(track);
            var t = Text(label, 0, null, T.Text);
            t.Margin = new Thickness(9, 0, 0, 0);
            t.VerticalAlignment = VerticalAlignment.Center;
            sp.Children.Add(t);
            sp.MouseLeftButtonUp += delegate { value = !value; paint(); changed(value); };
            return sp;
        }

        static string Size(long b)
        {
            if (b < 1024 * 1024) return Math.Max(1, b / 1024) + " КБ";
            return (b / 1024.0 / 1024.0).ToString("0.0") + " МБ";
        }

        // ---------- каркас окна ----------

        UIElement BuildShell()
        {
            var outer = new Border
            {
                Margin = new Thickness(12), CornerRadius = R(1.25), Background = T.B(T.Bg),
                BorderBrush = T.B(T.Border), BorderThickness = new Thickness(1),
                Effect = new DropShadowEffect { BlurRadius = 18, ShadowDepth = 2, Opacity = 0.55, Color = Colors.Black },
            };
            var root = new Grid { ClipToBounds = true };
            outer.Child = root;
            outer.SizeChanged += delegate
            {
                root.Clip = new RectangleGeometry(new Rect(0, 0, outer.ActualWidth - 2, outer.ActualHeight - 2), T.Radius * 1.25, T.Radius * 1.25);
            };

            var bg = Img(T.BgImage);
            if (bg != null)
            {
                var img = new Image { Source = bg, Stretch = Stretch.UniformToFill };
                if (T.BgBlur > 0)
                {
                    img.Effect = new BlurEffect { Radius = T.BgBlur, KernelType = KernelType.Gaussian };
                    img.RenderTransformOrigin = new Point(0.5, 0.5);
                    img.RenderTransform = new ScaleTransform(1.08, 1.08);
                }
                root.Children.Add(img);
                var dim = new LinearGradientBrush(Color.FromArgb((byte)(255 * T.BgDim * 0.75), T.Bg.R, T.Bg.G, T.Bg.B),
                    Color.FromArgb((byte)(255 * Math.Min(1, T.BgDim * 1.25)), T.Bg.R, T.Bg.G, T.Bg.B), 90);
                root.Children.Add(new Rectangle { Fill = dim });
            }

            var layout = new Grid();
            layout.RowDefinitions.Add(new RowDefinition { Height = new GridLength(70) });
            layout.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.Children.Add(layout);

            var header = BuildHeader();
            layout.Children.Add(header);
            body = new Grid { Margin = new Thickness(22, 4, 22, 14) };
            Grid.SetRow(body, 1);
            layout.Children.Add(body);
            footer = new Grid();
            Grid.SetRow(footer, 2);
            layout.Children.Add(footer);

            overlay = new Grid { Visibility = Visibility.Collapsed, Background = T.B(Colors.Black, 0.6) };
            root.Children.Add(overlay);
            return outer;
        }

        UIElement BuildHeader()
        {
            var g = new Grid { Background = Brushes.Transparent, Margin = new Thickness(22, 0, 12, 0) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.MouseLeftButtonDown += delegate (object s, MouseButtonEventArgs e) { if (e.ButtonState == MouseButtonState.Pressed) DragMove(); };

            var logo = Img(T.Logo);
            if (logo != null)
            {
                var lb = new Border { Width = 40, Height = 40, CornerRadius = R(0.6), Margin = new Thickness(0, 0, 12, 0),
                    Background = new ImageBrush(logo) { Stretch = Stretch.UniformToFill } };
                g.Children.Add(lb);
            }
            var titles = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            titles.Children.Add(Text(M.Name, 16, FontWeights.Bold, null, false, true));
            var sub = "Версия " + M.Version + (string.IsNullOrEmpty(M.Author) ? "" : "  •  " + M.Author) + (string.IsNullOrEmpty(M.GameVersion) ? "" : "  •  для игры " + M.GameVersion);
            titles.Children.Add(Text(sub, 12, null, T.Muted));
            Grid.SetColumn(titles, 1);
            g.Children.Add(titles);

            var right = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            updateBtn = Button("Обновление", "outline", ShowUpdate, 34);
            updateBtn.Visibility = Visibility.Collapsed;
            updateBtn.Margin = new Thickness(0, 0, 8, 0);
            right.Children.Add(updateBtn);
            if (M.Changelog.Any(c => !string.IsNullOrWhiteSpace(c.Text)))
            {
                var cl = Button("Что нового", "ghost", ShowChangelog, 34);
                cl.Margin = new Thickness(0, 0, 8, 0);
                right.Children.Add(cl);
            }
            right.Children.Add(WinButton("M 0,5 H 10", delegate { WindowState = WindowState.Minimized; }));
            right.Children.Add(WinButton("M 0,0 L 10,10 M 10,0 L 0,10", delegate { Close(); }));
            Grid.SetColumn(right, 2);
            g.Children.Add(right);
            return g;
        }

        Border WinButton(string path, Action click)
        {
            var b = new Border
            {
                Width = 36, Height = 32, CornerRadius = R(0.5), Background = Brushes.Transparent, Cursor = Cursors.Hand,
                Child = new Path { Data = Geometry.Parse(path), Stroke = T.B(T.Muted), StrokeThickness = 1.4, Width = 10, Height = 10, Stretch = Stretch.None,
                    HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center },
            };
            b.MouseEnter += delegate { b.Background = T.B(T.Card); };
            b.MouseLeave += delegate { b.Background = Brushes.Transparent; };
            b.MouseLeftButtonUp += delegate { click(); };
            return b;
        }

        void Swap(UIElement content, UIElement foot)
        {
            body.Children.Clear();
            body.Children.Add(content);
            footer.Children.Clear();
            if (foot != null) footer.Children.Add(foot);
            if (T.Animations)
            {
                content.Opacity = 0;
                var fe = content as FrameworkElement;
                var tr = new TranslateTransform(0, 14);
                if (fe != null) fe.RenderTransform = tr;
                content.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(260)));
                tr.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(14, 0, TimeSpan.FromMilliseconds(320)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
            }
        }

        // ---------- экраны ----------

        public void ShowWelcome()
        {
            var g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.55, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(20) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var left = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            var banner = Img(T.Banner);
            if (banner != null)
            {
                left.Children.Add(new Border { Height = 230, CornerRadius = R(), Margin = new Thickness(0, 0, 0, 22),
                    Background = new ImageBrush(banner) { Stretch = Stretch.UniformToFill }, BorderBrush = T.B(T.Border), BorderThickness = new Thickness(1) });
            }
            left.Children.Add(Text(T.WelcomeTitle, 34, FontWeights.Bold, null, true, true));
            var desc = Text(T.WelcomeText, 15, null, T.Text, true);
            desc.Opacity = 0.85;
            desc.Margin = new Thickness(0, 10, 0, 18);
            desc.MaxHeight = 140;
            left.Children.Add(desc);
            var chips = new WrapPanel { Margin = new Thickness(0, 0, 0, 22) };
            var mods = M.Mods().ToList();
            foreach (var chip in new[] { "Версия " + M.Version, mods.Count + " модов", Size(mods.Sum(n => n.Size)), string.IsNullOrEmpty(M.GameVersion) ? null : "Для игры " + M.GameVersion })
            {
                if (chip == null) continue;
                chips.Children.Add(new Border { CornerRadius = new CornerRadius(14), Padding = new Thickness(12, 5, 12, 5), Margin = new Thickness(0, 0, 8, 8),
                    Background = T.B(T.Accent, 0.14), BorderBrush = T.B(T.Accent, 0.4), BorderThickness = new Thickness(1),
                    Child = Text(chip, 12, FontWeights.SemiBold, T.Accent) });
            }
            left.Children.Add(chips);
            var btns = new StackPanel { Orientation = Orientation.Horizontal };
            btns.Children.Add(Button("Выбрать моды", "primary", ShowMods, 46));
            var quick = Button("Установить рекомендуемое", "default", delegate { ResetDefaults(); StartInstall(); }, 46);
            quick.Margin = new Thickness(10, 0, 0, 0);
            btns.Children.Add(quick);
            left.Children.Add(btns);
            g.Children.Add(left);

            var right = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            right.Children.Add(GameCard());
            var latest = M.Changelog.FirstOrDefault(c => !string.IsNullOrWhiteSpace(c.Text));
            if (latest != null)
            {
                var sp = new StackPanel();
                sp.Children.Add(Text("Что нового в версии " + latest.Version, 15, FontWeights.Bold));
                var t = Text(latest.Text, 13, null, T.Text, true);
                t.Opacity = 0.85;
                t.Margin = new Thickness(0, 8, 0, 0);
                t.MaxHeight = 190;
                sp.Children.Add(t);
                var p = Box(sp);
                p.Margin = new Thickness(0, 14, 0, 0);
                right.Children.Add(p);
            }
            Grid.SetColumn(right, 2);
            g.Children.Add(right);
            Swap(g, null);
        }

        UIElement GameCard()
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
            if (installed != null)
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
                if (Mode == "manage") ShowManage(); else if (body.Children.Count > 0 && footer.Children.Count > 0) ShowMods(); else ShowWelcome();
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

        // --- выбор модов ---

        public void ShowMods()
        {
            var g = new Grid();
            var sidebar = T.Nav == "sidebar";
            if (sidebar) g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(190) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(330) });
            int col = 0;

            var cats = new List<KeyValuePair<string, string>> { new KeyValuePair<string, string>("all", "Все моды") };
            foreach (var n in M.Tree.Where(n => n.IsGroup && n.Mods().Any())) cats.Add(new KeyValuePair<string, string>(n.Id, n.Name));
            if (M.Tree.Any(n => !n.IsGroup)) cats.Add(new KeyValuePair<string, string>("other", "Отдельные моды"));
            cats.Add(new KeyValuePair<string, string>("selected", "Выбранные"));

            var main = new Grid();
            main.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            main.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            var top = new DockPanel { Margin = new Thickness(0, 0, 0, 12), LastChildFill = true };
            var search = new TextBox
            {
                Width = 220, Height = 36, Padding = new Thickness(10, 0, 10, 0), VerticalContentAlignment = VerticalAlignment.Center,
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
            var sbox = new Border { CornerRadius = R(0.75), Background = T.B(T.Card, T.SurfaceOpacity), BorderBrush = T.B(T.Border), BorderThickness = new Thickness(1), Child = sg,
                VerticalAlignment = VerticalAlignment.Top, Height = 38, Margin = new Thickness(12, 0, 0, 0) };
            DockPanel.SetDock(sbox, Dock.Right);
            top.Children.Add(sbox);
            search.TextChanged += delegate
            {
                query = search.Text;
                hint.Visibility = string.IsNullOrEmpty(query) ? Visibility.Visible : Visibility.Collapsed;
                FillList();
            };

            if (!sidebar)
            {
                var tabs = new WrapPanel { VerticalAlignment = VerticalAlignment.Center };
                foreach (var c in cats) tabs.Children.Add(CategoryChip(c.Key, c.Value, false));
                top.Children.Add(tabs);
            }
            main.Children.Add(top);

            listScroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Padding = new Thickness(0, 0, 6, 0) };
            Grid.SetRow(listScroll, 1);
            main.Children.Add(listScroll);

            if (sidebar)
            {
                var nav = new StackPanel();
                foreach (var c in cats) nav.Children.Add(CategoryChip(c.Key, c.Value, true));
                var np = Box(nav, new Thickness(8));
                np.VerticalAlignment = VerticalAlignment.Stretch;
                np.Margin = new Thickness(0, 0, 16, 0);
                g.Children.Add(np);
                col = 1;
            }
            Grid.SetColumn(main, col);
            g.Children.Add(main);

            detailHost = new Grid();
            Grid.SetColumn(detailHost, col + 2);
            g.Children.Add(detailHost);

            Swap(g, ModsFooter());
            FillList();
            ShowDetail(current ?? M.Mods().FirstOrDefault());
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
                CornerRadius = vertical ? R(0.6) : new CornerRadius(18), Padding = new Thickness(14, 7, 12, 7), Cursor = Cursors.Hand,
                Margin = vertical ? new Thickness(0, 0, 0, 4) : new Thickness(0, 0, 8, 8),
                Background = on ? T.B(T.Accent) : (vertical ? Brushes.Transparent : T.B(T.Card, T.SurfaceOpacity)),
                BorderBrush = on ? T.B(T.Accent) : T.B(T.Border), BorderThickness = new Thickness(vertical ? 0 : 1), Child = sp,
            };
            b.MouseLeftButtonUp += delegate { category = key; ShowMods(); };
            return b;
        }

        IEnumerable<Node> Matches(IEnumerable<Node> nodes)
        {
            var q = (query ?? "").Trim().ToLowerInvariant();
            return nodes.Where(n => !n.IsGroup && (q.Length == 0 || (n.Name + " " + n.Description + " " + n.Author).ToLowerInvariant().Contains(q)));
        }

        void FillList()
        {
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
                Panel wrap = T.Layout == "list" ? (Panel)new StackPanel() : new WrapPanel();
                foreach (var n in list) wrap.Children.Add(T.Layout == "list" ? ModRow(n) : ModCard(n));
                sp.Children.Add(wrap);
            };
            Func<Node, string> hintOf = n => n.Mode == "single" ? "выберите один вариант" : null;
            Action<Node> groupSections = null;
            groupSections = delegate (Node grp)
            {
                section(grp.Path.Length > 0 ? grp.Path + " › " + grp.Name : grp.Name, hintOf(grp), grp.Children.Where(c => !c.IsGroup));
                foreach (var c in grp.Children.Where(c => c.IsGroup)) groupSections(c);
            };

            if (category == "selected") section(null, null, M.Mods().Where(n => n.Selected));
            else if (category == "other") section(null, null, M.Tree.Where(n => !n.IsGroup));
            else if (category == "all")
            {
                foreach (var n in M.Tree.Where(n => n.IsGroup)) groupSections(n);
                section(M.Tree.Any(n => n.IsGroup) ? "Отдельные моды" : null, null, M.Tree.Where(n => !n.IsGroup));
            }
            else groupSections(M.Tree.First(n => n.Id == category));

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
            var off = listScroll.VerticalOffset;
            FillList();
            listScroll.ScrollToVerticalOffset(off);
            ShowDetail(n);
            RefreshFooter();
        }

        UIElement ModCard(Node n)
        {
            double w = T.CardSize == "s" ? 168 : T.CardSize == "l" ? 262 : 210;
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
            var pic = new Border { CornerRadius = new CornerRadius(Math.Max(0, T.Radius - 1), Math.Max(0, T.Radius - 1), 0, 0), Background = img != null ? (Brush)new ImageBrush(img) { Stretch = Stretch.UniformToFill } : T.B(T.Surface) };
            g.Children.Add(pic);
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
            HoverLift(card);
            card.MouseLeftButtonUp += delegate (object s, MouseButtonEventArgs e)
            {
                if (e.GetPosition(card).Y < w * 9 / 16 && e.GetPosition(card).X < w - 44 && current != n) { current = n; ShowDetail(n); FillListKeep(); }
                else Toggle(n);
            };
            return card;
        }

        void FillListKeep()
        {
            var off = listScroll.VerticalOffset;
            FillList();
            listScroll.ScrollToVerticalOffset(off);
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
            var d = Text((n.Description ?? "").Split('\n')[0], 12, null, T.Muted);
            txt.Children.Add(d);
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

        void HoverLift(Border b)
        {
            if (!T.Animations) return;
            var tr = new TranslateTransform();
            b.RenderTransform = tr;
            b.MouseEnter += delegate { tr.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(-3, TimeSpan.FromMilliseconds(140))); };
            b.MouseLeave += delegate { tr.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, TimeSpan.FromMilliseconds(160))); };
        }

        void ShowDetail(Node n)
        {
            detailHost.Children.Clear();
            if (n == null) return;
            current = n;
            var g = new Grid();
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var img = Img(n.Image);
            g.Children.Add(new Border { Height = 330 * 9 / 16 - 2, CornerRadius = new CornerRadius(Math.Max(0, T.Radius - 1), Math.Max(0, T.Radius - 1), 0, 0),
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
            var p = Box(g, new Thickness(0));
            detailHost.Children.Add(p);
        }

        TextBlock sumText;
        UIElement ModsFooter()
        {
            var bar = new Border { Background = T.B(T.Surface, T.SurfaceOpacity), BorderBrush = T.B(T.Border), BorderThickness = new Thickness(0, 1, 0, 0), Padding = new Thickness(22, 12, 22, 12) };
            var g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var left = new StackPanel();
            var gameRow = new StackPanel { Orientation = Orientation.Horizontal, Cursor = Cursors.Hand };
            gameRow.Children.Add(new Ellipse { Width = 9, Height = 9, Fill = T.B(gameVersion != null ? T.Success : T.Danger), Margin = new Thickness(0, 0, 8, 0) });
            gameRow.Children.Add(Text(gameVersion != null ? gameDir + "  ·  " + gameVersion : "Игра не найдена — нажмите, чтобы указать папку", 12.5, FontWeights.SemiBold));
            var change = Text("  Изменить", 12.5, FontWeights.SemiBold, T.Accent);
            gameRow.Children.Add(change);
            gameRow.MouseLeftButtonUp += delegate { PickFolder(); };
            left.Children.Add(gameRow);
            var opts = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 9, 0, 0) };
            opts.Children.Add(Toggle("Убрать старые моды (в бэкап)", cleanOld, v => cleanOld = v));
            opts.Children.Add(Toggle("Ярлык на рабочем столе", shortcut, v => shortcut = v));
            left.Children.Add(opts);
            g.Children.Add(left);

            var right = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            sumText = Text("", 13, FontWeights.SemiBold, T.Muted);
            sumText.VerticalAlignment = VerticalAlignment.Center;
            sumText.Margin = new Thickness(0, 0, 16, 0);
            right.Children.Add(sumText);
            if (T.WelcomeScreen)
            {
                var back = Button("Назад", "ghost", ShowWelcome, 46);
                back.Margin = new Thickness(0, 0, 8, 0);
                right.Children.Add(back);
            }
            right.Children.Add(Button(Mode == "preview" ? T.InstallText + " (предпросмотр)" : T.InstallText, "primary", StartInstall, 46));
            Grid.SetColumn(right, 1);
            g.Children.Add(right);
            bar.Child = g;
            RefreshFooter();
            return bar;
        }

        void RefreshFooter()
        {
            if (sumText == null) return;
            var sel = M.Mods().Where(n => n.Selected).ToList();
            sumText.Text = "Выбрано: " + sel.Count + "  ·  " + Size(sel.Sum(n => n.Size));
        }

        // --- установка ---

        void StartInstall()
        {
            if (Mode == "preview")
            {
                ShowProgressDemo();
                return;
            }
            if (gameVersion == null) { Alert("Игра не найдена", "Укажите папку, где установлен «Мир танков»."); PickFolder(); return; }
            if (!M.Mods().Any(n => n.Selected)) { Alert("Ничего не выбрано", "Отметьте хотя бы один мод."); return; }
            if (Process.GetProcessesByName("WorldOfTanks").Any())
            {
                Alert("Игра запущена", "Закройте «Мир танков» перед установкой модов, иначе файлы могут не замениться.");
                return;
            }
            Action<double, string> progress;
            var screen = ProgressScreen(out progress);
            Swap(screen, null);
            var engine = new Engine(M);
            engine.Progress = (p, s) => Dispatcher.BeginInvoke(new Action(() => progress(p, s)));
            var dir = gameDir;
            bool clean = cleanOld, sc = shortcut;
            Task.Factory.StartNew(() => engine.Install(dir, clean, sc)).ContinueWith(t => Dispatcher.BeginInvoke(new Action(() =>
            {
                if (t.IsFaulted)
                {
                    var ex = t.Exception.GetBaseException();
                    var admin = ex is UnauthorizedAccessException;
                    ShowMods();
                    Alert("Не удалось установить", admin
                        ? "Нет прав на запись в папку игры. Запустите установщик от имени администратора (правой кнопкой → «Запуск от имени администратора»)."
                        : ex.Message);
                }
                else
                {
                    RefreshGame();
                    ShowFinish(false);
                }
            })));
        }

        UIElement ProgressScreen(out Action<double, string> progress)
        {
            var sp = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, Width = 520 };
            sp.Children.Add(Text("Устанавливаю моды…", 26, FontWeights.Bold, null, false, true));
            var cur = Text("Подготовка…", 13, null, T.Muted);
            cur.Margin = new Thickness(0, 8, 0, 22);
            sp.Children.Add(cur);
            var track = new Border { Height = 12, CornerRadius = new CornerRadius(6), Background = T.B(T.Card), BorderBrush = T.B(T.Border), BorderThickness = new Thickness(1) };
            var fill = new Border { CornerRadius = new CornerRadius(6), HorizontalAlignment = HorizontalAlignment.Left, Width = 0,
                Background = new LinearGradientBrush(T.Accent, Color.FromArgb(255, (byte)Math.Min(255, T.Accent.R + 40), (byte)Math.Min(255, T.Accent.G + 40), (byte)Math.Min(255, T.Accent.B + 40)), 0),
                Effect = new DropShadowEffect { Color = T.Accent, BlurRadius = 14, ShadowDepth = 0, Opacity = 0.5 } };
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
            return sp;
        }

        void ShowProgressDemo()
        {
            Action<double, string> progress;
            Swap(ProgressScreen(out progress), null);
            var mods = M.Mods().Where(n => n.Selected).Select(n => n.Name).DefaultIfEmpty("Моды").ToList();
            var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(60) };
            double p = 0;
            timer.Tick += delegate
            {
                p += 0.02;
                progress(Math.Min(1, p), "Предпросмотр: " + mods[(int)(Math.Min(0.999, p) * mods.Count)]);
                if (p >= 1) { timer.Stop(); ShowFinish(false); }
            };
            timer.Start();
        }

        void ShowFinish(bool removed)
        {
            var sp = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, MaxWidth = 560 };
            var circle = new Grid { Width = 84, Height = 84, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 20) };
            circle.Children.Add(new Ellipse { Fill = T.B(T.Accent, 0.15), Stroke = T.B(T.Accent), StrokeThickness = 2 });
            circle.Children.Add(new Path { Data = Geometry.Parse("M 26,43 L 37,54 L 59,31"), Stroke = T.B(T.Accent), StrokeThickness = 5,
                StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round });
            sp.Children.Add(circle);
            var title = Text(removed ? "Модпак удалён" : T.FinishTitle, 30, FontWeights.Bold, null, true, true);
            title.TextAlignment = TextAlignment.Center;
            sp.Children.Add(title);
            var txt = Text(removed ? "Файлы модпака удалены, заменённые файлы игры восстановлены." : (Mode == "preview" ? "Это предпросмотр: файлы не устанавливались.\n" + T.FinishText : T.FinishText), 15, null, T.Text, true);
            txt.TextAlignment = TextAlignment.Center;
            txt.Opacity = 0.85;
            txt.Margin = new Thickness(0, 10, 0, 26);
            sp.Children.Add(txt);
            var btns = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center };
            var exe = gameDir == null ? null : Game.Exe(gameDir);
            if (!removed && M.LaunchGame && (exe != null || Mode == "preview"))
                btns.Children.Add(Button("Запустить игру", "primary", delegate
                {
                    if (exe != null) Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = gameDir, UseShellExecute = true });
                    Close();
                }, 46));
            if (gameDir != null)
            {
                var f = Button("Открыть папку игры", "default", delegate { Process.Start("explorer.exe", "\"" + gameDir + "\""); }, 46);
                f.Margin = new Thickness(10, 0, 0, 0);
                btns.Children.Add(f);
            }
            var c = Button("Закрыть", "ghost", Close, 46);
            c.Margin = new Thickness(10, 0, 0, 0);
            btns.Children.Add(c);
            sp.Children.Add(btns);
            Swap(sp, null);
        }

        // --- управление установленным модпаком ---

        public void ShowManage()
        {
            var sp = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, Width = 620 };
            sp.Children.Add(Text(installed != null ? "Модпак установлен" : "Модпак не найден в игре", 30, FontWeights.Bold, null, true, true));
            var info = installed != null
                ? "Версия " + installed.Version + "  ·  " + installed.Selected.Count + " модов  ·  установлен " + installed.InstalledAt.Replace('T', ' ')
                : "Укажите папку игры, в которую ставился модпак.";
            var t = Text(info, 14, null, T.Muted, true);
            t.Margin = new Thickness(0, 8, 0, 18);
            sp.Children.Add(t);
            sp.Children.Add(GameCard());
            var btns = new WrapPanel { Margin = new Thickness(0, 18, 0, 0) };
            var hasSource = M.UpdateType != "none";
            var upd = Button(update != null ? "Обновить до версии " + update.Version : "Проверить обновления", "primary", delegate
            {
                if (update != null) ShowUpdate();
                else CheckUpdateAsync(true);
            }, 44);
            if (hasSource) btns.Children.Add(upd);
            if (installed != null)
            {
                var del = Button("Удалить модпак", "danger", ConfirmUninstall, 44);
                del.Margin = new Thickness(hasSource ? 10 : 0, 0, 0, 0);
                btns.Children.Add(del);
            }
            sp.Children.Add(btns);
            if (!hasSource)
            {
                var n = Text("Автор модпака не настроил обновления — новую версию нужно скачать вручную.", 12, null, T.Muted, true);
                n.Margin = new Thickness(0, 12, 0, 0);
                sp.Children.Add(n);
            }
            Swap(sp, null);
        }

        void ConfirmUninstall()
        {
            Modal("Удалить модпак?", "Файлы модпака будут удалены из игры, заменённые файлы вернутся из резервной копии.",
                "Удалить", "danger", delegate
                {
                    var dir = gameDir;
                    Task.Factory.StartNew(() => new Engine(M).Uninstall(dir)).ContinueWith(t => Dispatcher.BeginInvoke(new Action(() =>
                    {
                        if (t.IsFaulted) Alert("Ошибка удаления", t.Exception.GetBaseException().Message);
                        else { installed = null; ShowFinish(true); }
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
                update = t.Result;
                if (update != null)
                {
                    ((TextBlock)updateBtn.Child).Text = "⬆  Обновить до " + update.Version;
                    updateBtn.Visibility = Visibility.Visible;
                    if (T.Animations)
                        updateBtn.BeginAnimation(OpacityProperty, new DoubleAnimation(1, 0.55, TimeSpan.FromMilliseconds(900)) { AutoReverse = true, RepeatBehavior = new RepeatBehavior(4) });
                }
                else if (manual) Alert("Обновлений нет", "У вас последняя версия модпака.");
                if (Mode == "manage") ShowManage();
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
                if (total > 0) fill.Width = (track.ActualWidth) * got / total;
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
            Modal("Что нового", text, null, null, null);
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

        // ---------- снимок окна без показа на экране (для конструктора и тестов) ----------

        public void Snapshot(string file, string screen)
        {
            if (screen == "mods") ShowMods();
            else if (screen == "finish") ShowFinish(false);
            else if (screen == "manage") ShowManage();
            else if (screen == "changelog") ShowChangelog();
            else if (screen == "progress") { Action<double, string> p; Swap(ProgressScreen(out p), null); Dispatcher.BeginInvoke(new Action(() => p(0.62, "Лампа «Шестое чувство»")), System.Windows.Threading.DispatcherPriority.Loaded); }
            else ShowWelcome();
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
