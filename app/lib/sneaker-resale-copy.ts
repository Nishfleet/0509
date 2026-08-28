import type { FaqJsonLdEntry } from "~/lib/seo";
import type { SneakerResaleLocaleId } from "~/lib/locale-markets";

export interface SneakerResaleCopy {
  title: string;
  description: string;
  kicker: string;
  h1: string;
  deck: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchButton: string;
  problemKicker: string;
  problemTitle: string;
  problems: ReadonlyArray<{ title: string; detail: string }>;
  productKicker: string;
  productTitle: string;
  products: ReadonlyArray<{ title: string; detail: string }>;
  brandsKicker: string;
  brandsTitle: string;
  brandsDeck: string;
  honestKicker: string;
  honestTitle: string;
  honest: ReadonlyArray<{ title: string; detail: string }>;
  faqKicker: string;
  faqTitle: string;
  faq: ReadonlyArray<FaqJsonLdEntry>;
  ctaKicker: string;
  ctaTitle: string;
  ctaBody: string;
  ctaButton: string;
  otherLanguagesLabel: string;
}

const EN: SneakerResaleCopy = {
  title: "Sneaker resale competitor ads | Five to Nine",
  description:
    "Watch sneaker-resale competitors' Meta ads and landing pages. Saved screenshots, not a swipe file. Public search is free. The app is English; checkout currency follows you.",
  kicker: "Sneaker resale · competitor ads",
  h1: "See the drop they posted before you price yours.",
  deck: "Five to Nine watches the Meta ads and landing pages of other resellers. When the offer, the CTA, or the page copy moves, you get the screenshot and the original link — not a mood-board of creatives.",
  searchLabel: "Public search preview",
  searchPlaceholder: "paste-a-competitor-website.com…",
  searchButton: "Try it free, no account",
  problemKicker: "The gap",
  problemTitle: "English spy tools were not built for this job.",
  problems: [
    {
      title: "They save ads. They do not tell you what changed.",
      detail:
        "A swipe file is a pile of creatives. Pricing a Jordan restock needs the old offer next to the new one, with a timestamp, not another board of screenshots.",
    },
    {
      title: "The Ad Library only answers when you remember to open it.",
      detail:
        "Competitors change size runs and landing copy on their clock. The check that matters is the one you skip on a restock morning.",
    },
    {
      title: "US-only pages ignore how non-English shops actually search.",
      detail:
        "Most ad-spy marketing is English. If your buyers search in German, Japanese, or Portuguese, those tools are not even in the results.",
    },
  ],
  productKicker: "What you get",
  productTitle: "Change receipts, on a schedule.",
  products: [
    {
      title: "Scheduled Meta checks",
      detail:
        "Paid plans check watched competitors every 3–6 hours. Scout is every 6 hours; Starter is every 3 hours; Agency is every 3 hours on the first 25 watchlists and every 6 hours on the rest.",
    },
    {
      title: "Before and after, saved",
      detail:
        "Each scan is compared with the last one. You hear about a new hook or a dropped price because the page actually moved, not because the ad is still running.",
    },
    {
      title: "The original link stays",
      detail:
        "Confirmed changes keep the screenshot, the page text, and the source URL. Close the tab and the receipt is still there.",
    },
  ],
  brandsKicker: "Brands we watch",
  brandsTitle: "Real sneaker-resale advertisers, real ad pages.",
  brandsDeck:
    "These brands are running Meta ads right now. Each link opens the live ad page we built from real captures — the same proof a watchlist tracks.",
  honestKicker: "Honest limits",
  honestTitle: "What this page does not pretend.",
  honest: [
    {
      title: "The product UI is English",
      detail:
        "These pages are in your language so search can find them. The signed-in app, emails, and help stay English for now. Checkout shows prices in the buyer's currency.",
    },
    {
      title: "Meta Ad Library only",
      detail:
        "We read Meta's public Ad Library. TikTok, Google, and other libraries are not aggregated. If you need a multi-platform spy database, that is a different product.",
    },
    {
      title: "We count signups that stay, not visits",
      detail:
        "A useful locale page is one that produces an account which still has a watchlist a week later. Raw traffic is not the score.",
    },
  ],
  faqKicker: "FAQ",
  faqTitle: "Straight answers for reseller teams.",
  faq: [
    {
      question: "Do I need an account to look?",
      answer:
        "No. The public search preview is free and needs no card. Saving competitors and scheduled checks need an account. The free plan watches one competitor with a weekly brief.",
    },
    {
      question: "Is the app translated?",
      answer:
        "Not yet. This landing page is. The workspace, alerts, and docs are English. Currency at checkout follows the buyer.",
    },
    {
      question: "Do you cover StockX or GOAT ads?",
      answer:
        "We watch whoever is running Meta ads — a boutique, a Discord seller with a shop page, a regional chain. We do not scrape StockX or GOAT listings.",
    },
    {
      question: "How fast will I hear about a change?",
      answer:
        "Scout every 6 hours. Starter every 3 hours. Agency every 3 hours on the first 25 watchlists, every 6 hours on the rest. Instant alerts are on Starter and Agency, not Scout.",
    },
  ],
  ctaKicker: "Start watching",
  ctaTitle: "Paste a competitor. Keep the receipt.",
  ctaBody:
    "Sign up free — no card. Public search stays free either way. Plans and live prices are on the pricing page.",
  ctaButton: "Create a free account",
  otherLanguagesLabel: "This page in other languages",
};

const DE: SneakerResaleCopy = {
  title: "Konkurrenzanzeigen für Reseller | Five to Nine",
  description:
    "Meta-Anzeigen und Landingpages anderer Sneaker-Reseller beobachten. Mit Screenshot, nicht als Moodboard. Suche ohne Konto. Die App ist englisch; die Kasse folgt deiner Währung.",
  kicker: "Sneaker-Resale · Konkurrenzanzeigen",
  h1: "Sieh die Anzeige, bevor du deinen Preis setzt.",
  deck: "Five to Nine prüft Meta-Anzeigen und Seiten anderer Reseller. Wenn Angebot, Button oder Seitentext kippt, bleibt der Screenshot und der Originallink — kein weiteres Board voller Creatives.",
  searchLabel: "Öffentliche Suche",
  searchPlaceholder: "konkurrent-website.de…",
  searchButton: "Kostenlos testen, ohne Konto",
  problemKicker: "Die Lücke",
  problemTitle: "Englische Spy-Tools kennen den DACH-Alltag nicht.",
  problems: [
    {
      title: "Sie sammeln Anzeigen. Sie sagen nicht, was sich geändert hat.",
      detail:
        "Ein Swipe File ist ein Stapel Bilder. Wer SNIPES oder den Laden nebenan preist, braucht das alte Angebot neben dem neuen, mit Uhrzeit.",
    },
    {
      title: "Die Ad Library antwortet nur, wenn du sie öffnest.",
      detail:
        "Konkurrenten ändern Größenläufe und Shop-Texte nach ihrem Kalender. Der Check, der zählt, ist der, den du am Restock-Morgen vergisst.",
    },
    {
      title: "US-Seiten tauchen in deutschen Suchen oft gar nicht auf.",
      detail:
        "Die großen Ad-Spy-Marken werben auf Englisch. Wer nach Konkurrenzanzeigen sucht, findet sie selten — nicht weil das Problem klein ist, sondern weil niemand auf Deutsch darüber spricht.",
    },
  ],
  productKicker: "Was du bekommst",
  productTitle: "Belege, auf einem Zeitplan.",
  products: [
    {
      title: "Geplante Meta-Prüfungen",
      detail:
        "Bezahlte Pläne prüfen beobachtete Konkurrenten alle 3–6 Stunden. Scout alle 6 Stunden; Starter alle 3 Stunden; Agency alle 3 Stunden auf den ersten 25 Watchlists, der Rest alle 6 Stunden.",
    },
    {
      title: "Vorher und nachher, gespeichert",
      detail:
        "Jeder Scan wird mit dem letzten verglichen. Du hörst von einem neuen Hook oder einem gestrichenen Preis, weil die Seite sich bewegt hat.",
    },
    {
      title: "Der Originallink bleibt",
      detail:
        "Bestätigte Änderungen behalten Screenshot, Seitentext und Quell-URL. Tab zu, Beleg da.",
    },
  ],
  brandsKicker: "Marken, die wir beobachten",
  brandsTitle: "Echte Sneaker-Resale-Werbetreibende, echte Anzeigenseiten.",
  brandsDeck:
    "Diese Marken schalten gerade Meta-Anzeigen. Jeder Link öffnet die Live-Anzeigenseite, die wir aus echten Erfassungen erstellt haben — derselbe Beleg, den eine Watchlist verfolgt.",
  honestKicker: "Ehrliche Grenzen",
  honestTitle: "Was diese Seite nicht behauptet.",
  honest: [
    {
      title: "Die App ist englisch",
      detail:
        "Diese Seite ist deutsch, damit Suche sie findet. Workspace, Mails und Hilfe bleiben vorerst englisch. An der Kasse siehst du Preise in der Währung des Käufers.",
    },
    {
      title: "Nur die Meta Ad Library",
      detail:
        "Wir lesen Metas öffentliche Ad Library. TikTok, Google und andere Bibliotheken werden nicht zusammengeführt.",
    },
    {
      title: "Wir zählen Konten, die bleiben, nicht Besuche",
      detail:
        "Eine nützliche Sprachseite ist eine, nach der eine Woche später noch eine Watchlist existiert. Klicks allein sind keine Note.",
    },
  ],
  faqKicker: "FAQ",
  faqTitle: "Klare Antworten für Reseller.",
  faq: [
    {
      question: "Brauche ich ein Konto zum Reinschauen?",
      answer:
        "Nein. Die öffentliche Suche ist kostenlos und braucht keine Karte. Gespeicherte Konkurrenten und geplante Checks brauchen ein Konto. Der Free-Plan beobachtet einen Konkurrenten mit einem wöchentlichen Briefing.",
    },
    {
      question: "Ist die App übersetzt?",
      answer:
        "Noch nicht. Diese Landingpage schon. Workspace, Alerts und Docs sind englisch. Die Währung an der Kasse folgt dem Käufer.",
    },
    {
      question: "Seht ihr StockX- oder Klekt-Listings?",
      answer:
        "Wir sehen, wer Meta-Anzeigen schaltet — Boutique, Regionalkette, Shop-Seite. StockX- und Klekt-Listings scrapen wir nicht.",
    },
    {
      question: "Wie schnell erfahre ich von einer Änderung?",
      answer:
        "Scout alle 6 Stunden. Starter alle 3 Stunden. Agency alle 3 Stunden auf den ersten 25 Watchlists, der Rest alle 6 Stunden. Sofort-Alerts gibt es auf Starter und Agency, nicht auf Scout.",
    },
  ],
  ctaKicker: "Beobachten",
  ctaTitle: "Konkurrent einfügen. Beleg behalten.",
  ctaBody:
    "Kostenlos anmelden — ohne Karte. Die öffentliche Suche bleibt frei. Pläne und live Preise stehen auf der Preisseite.",
  ctaButton: "Kostenloses Konto",
  otherLanguagesLabel: "Diese Seite in anderen Sprachen",
};

const JA: SneakerResaleCopy = {
  title: "スニーカー再販の競合広告 | Five to Nine",
  description:
    "他店のMeta広告とランディングページの変化を、スクリーンショット付きで残す。検索は無料。アプリは英語。決済の通貨は買い手に合わせる。",
  kicker: "スニーカー再販 · 競合広告",
  h1: "ライバルの告知を、値付けの前に。",
  deck: "Five to Nine は、他の再販店の Meta 広告とページを見ます。オファー、ボタン、本文が動いたとき、スクショと元リンクが残ります。クリエイティブを集めるボードではありません。",
  searchLabel: "公開検索",
  searchPlaceholder: "競合のサイトを貼る…",
  searchButton: "無料で試す（アカウント不要）",
  problemKicker: "足りないもの",
  problemTitle: "英語のスパイツールは、ドロップの朝に間に合わない。",
  problems: [
    {
      title: "広告は溜まる。何が変わったかは分からない。",
      detail:
        "スワイプファイルは画像の山です。限定の値付けに要るのは、古いオファーと新しいオファーを並べた時刻付きの記録です。",
    },
    {
      title: "Ad Library は、開いたときしか答えない。",
      detail:
        "競合は自分の都合でサイズとページ文を変えます。肝心な確認は、入荷の朝に抜けます。",
    },
    {
      title: "日本語で探す人向けのページが、ほぼ無い。",
      detail:
        "主要な広告スパイ製品の説明は英語です。日本語で競合広告を探すと、ツール自体が結果に出ません。",
    },
  ],
  productKicker: "残るもの",
  productTitle: "変化の証拠を、決まった間隔で。",
  products: [
    {
      title: "Meta の定期チェック",
      detail:
        "有料プランは、監視中の競合を 3〜6 時間ごとに見ます。Scout は 6 時間、Starter は 3 時間、Agency は先頭 25 件が 3 時間で残りは 6 時間です。",
    },
    {
      title: "前後の差分",
      detail:
        "毎回のスキャンを前回と比べます。新しいフックや値下げは、ページが実際に動いたときだけ届きます。",
    },
    {
      title: "元リンクが残る",
      detail:
        "確定した変化には、スクショ、ページ本文、出典 URL が付きます。タブを閉じても残ります。",
    },
  ],
  brandsKicker: "監視しているブランド",
  brandsTitle: "実在するスニーカーリセール広告主、実物の広告ページ。",
  brandsDeck:
    "これらのブランドは現在Meta広告を出しています。各リンクは実キャプチャから作成した広告ページを開きます。ウォッチリストが追跡するのと同じ証拠です。",
  honestKicker: "言わないこと",
  honestTitle: "このページが約束しない範囲。",
  honest: [
    {
      title: "アプリは英語",
      detail:
        "検索向けに、このページだけ日本語です。ログイン後の画面、メール、ヘルプは英語のままです。決済の表示通貨は買い手に従います。",
    },
    {
      title: "Meta Ad Library のみ",
      detail:
        "読むのは Meta の公開 Ad Library です。TikTok や Google の広告庫はまとめていません。",
    },
    {
      title: "残った登録だけを成績にする",
      detail:
        "意味のある言語ページは、一週間後もウォッチリストがあるアカウントを生むものです。閲覧数は成績ではありません。",
    },
  ],
  faqKicker: "FAQ",
  faqTitle: "再販チーム向けの短い答え。",
  faq: [
    {
      question: "見るだけならアカウントは要りますか。",
      answer:
        "不要です。公開検索は無料で、カードも要りません。競合の保存と定期チェックにはアカウントが要ります。無料プランは競合一件と週次のブリーフです。",
    },
    {
      question: "アプリは日本語ですか。",
      answer:
        "まだです。このランディングページは日本語です。ワークスペース、通知、ドキュメントは英語です。決済の通貨は買い手に合わせます。",
    },
    {
      question: "StockX の出品も見ますか。",
      answer:
        "Meta 広告を出している店なら見ます。StockX や SNKRDUNK の出品そのものは取得しません。",
    },
    {
      question: "変化はどれくらいで分かりますか。",
      answer:
        "Scout は 6 時間ごと。Starter は 3 時間ごと。Agency は先頭 25 件が 3 時間ごと、残りは 6 時間ごと。即時アラートは Starter と Agency のみで、Scout にはありません。",
    },
  ],
  ctaKicker: "監視を始める",
  ctaTitle: "競合を貼る。証拠は残す。",
  ctaBody:
    "無料登録、カード不要。公開検索はそのままで使えます。プランと表示価格は料金ページにあります。",
  ctaButton: "無料アカウント",
  otherLanguagesLabel: "他の言語",
};

const PT_BR: SneakerResaleCopy = {
  title: "Anúncios de concorrentes no resale | Five to Nine",
  description:
    "Veja anúncios e landing pages de outros resellers no Meta, com print. Busca pública grátis. O app é em inglês; o checkout usa a moeda de quem compra.",
  kicker: "Resale de sneakers · anúncios de concorrentes",
  h1: "Veja o anúncio deles antes de precificar o seu.",
  deck: "A Five to Nine acompanha anúncios e páginas de outros resellers no Meta. Quando a oferta, o botão ou o texto da página mudam, ficam o print e o link original — não mais um mural de criativos.",
  searchLabel: "Busca pública",
  searchPlaceholder: "cole-o-site-do-concorrente.com…",
  searchButton: "Testar grátis, sem conta",
  problemKicker: "A falha",
  problemTitle: "Ferramenta gringa não aparece quando você pesquisa em português.",
  problems: [
    {
      title: "Elas guardam anúncio. Não dizem o que mudou.",
      detail:
        "Swipe file é pilha de imagem. Para precificar um restock, você precisa da oferta antiga ao lado da nova, com hora — não de mais um board.",
    },
    {
      title: "A Ad Library só responde se você abrir.",
      detail:
        "Concorrente muda numeração e texto da página no horário dele. A checagem que importa é a que você pula na manhã do drop.",
    },
    {
      title: "Quase ninguém escreve essa página em português.",
      detail:
        "Ad spy grande fala inglês. Quem busca monitorar anúncio de concorrente em português quase não encontra um produto — o problema existe; a página não.",
    },
  ],
  productKicker: "O que fica",
  productTitle: "Comprovante de mudança, no relógio.",
  products: [
    {
      title: "Checagens no Meta no horário",
      detail:
        "Planos pagos olham concorrentes acompanhados a cada 3–6 horas. Scout a cada 6 horas; Starter a cada 3 horas; Agency a cada 3 horas nas primeiras 25 watchlists e a cada 6 horas no resto.",
    },
    {
      title: "Antes e depois, guardado",
      detail:
        "Cada varredura compara com a anterior. Você fica sabendo de gancho novo ou preço cortado porque a página mexeu.",
    },
    {
      title: "O link original permanece",
      detail:
        "Mudança confirmada leva print, texto da página e URL da fonte. Fecha a aba, o comprovante continua.",
    },
  ],
  brandsKicker: "Marcas que observamos",
  brandsTitle: "Anunciantes reais de revenda de tênis, páginas de anúncio reais.",
  brandsDeck:
    "Essas marcas estão rodando anúncios no Meta agora. Cada link abre a página de anúncio ao vivo que montamos com capturas reais — a mesma prova que uma watchlist acompanha.",
  honestKicker: "Limite honesto",
  honestTitle: "O que esta página não vende.",
  honest: [
    {
      title: "O app é em inglês",
      detail:
        "Esta página é em português para a busca achar. Área logada, e-mails e ajuda seguem em inglês. No checkout, o preço aparece na moeda de quem compra.",
    },
    {
      title: "Só a Meta Ad Library",
      detail:
        "Lemos a Ad Library pública da Meta. Não juntamos TikTok, Google nem outra biblioteca.",
    },
    {
      title: "Conta que permanece, não visita",
      detail:
        "Página de idioma boa é a que gera conta com watchlist uma semana depois. Tráfego cru não é nota.",
    },
  ],
  faqKicker: "FAQ",
  faqTitle: "Resposta curta para loja de resale.",
  faq: [
    {
      question: "Preciso de conta só para olhar?",
      answer:
        "Não. A busca pública é grátis e não pede cartão. Salvar concorrente e checagem no relógio pedem conta. O plano free observa um concorrente com briefing semanal.",
    },
    {
      question: "O app está em português?",
      answer:
        "Ainda não. Esta landing está. Workspace, alertas e docs são em inglês. A moeda no checkout segue quem compra.",
    },
    {
      question: "Vocês veem anúncio da StockX ou da Grailz?",
      answer:
        "Vemos quem veicula anúncio no Meta — boutique, rede, página de loja. Não raspamos listagem de marketplace.",
    },
    {
      question: "Em quanto tempo eu fico sabendo da mudança?",
      answer:
        "Scout a cada 6 horas. Starter a cada 3 horas. Agency a cada 3 horas nas primeiras 25 watchlists e a cada 6 horas no resto. Alerta na hora existe no Starter e no Agency, não no Scout.",
    },
  ],
  ctaKicker: "Começar a olhar",
  ctaTitle: "Cola o concorrente. Fica o comprovante.",
  ctaBody:
    "Cadastro grátis, sem cartão. A busca pública continua livre. Planos e preços ao vivo estão na página de preços.",
  ctaButton: "Criar conta grátis",
  otherLanguagesLabel: "Esta página em outros idiomas",
};

const COPY_BY_LOCALE: Record<SneakerResaleLocaleId, SneakerResaleCopy> = {
  en: EN,
  de: DE,
  ja: JA,
  "pt-br": PT_BR,
};

export function sneakerResaleCopy(id: SneakerResaleLocaleId): SneakerResaleCopy {
  return COPY_BY_LOCALE[id];
}
