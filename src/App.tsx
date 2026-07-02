import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  BookOpenText,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Coins,
  Home,
  LineChart,
  NotebookTabs,
  Plus,
  ReceiptText,
  ScanLine,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";

type TabKey = "home" | "analysis" | "receipts";

type ThoughtReceipt = {
  id: string;
  date: string;
  time: string;
  topic: string;
  category: string;
  aiRole: string;
  aiScreenTimeMinutes: number;
  gained: string;
  feelingBefore: string;
  feelingAfter: string;
  distanceLevel: "ほどよい" | "近め" | "じっくり";
  selfDecision: string;
  thoughtBalance: string;
};

type ReceiptFilter =
  | { type: "category"; value: string }
  | { type: "role"; value: string }
  | { type: "moodChange" }
  | { type: "selfDecision" };

// 応募用プロトタイプなので、外部DBではなく画面確認用のサンプルデータを置いています。
const STORAGE_KEY = "watashi-to-ai-thought-receipts";

const initialReceipts: ThoughtReceipt[] = [
  {
    id: "R-20260630-001",
    date: "2026-06-30",
    time: "21:30",
    topic: "企画制作について相談",
    category: "企画・制作",
    aiRole: "相棒",
    aiScreenTimeMinutes: 18,
    gained: "アイデア整理",
    feelingBefore: "迷い",
    feelingAfter: "納得",
    distanceLevel: "近め",
    selfDecision: "アプリ側を自分が担当する",
    thoughtBalance: "役割分担が明確になった",
  },
  {
    id: "R-20260629-002",
    date: "2026-06-29",
    time: "23:05",
    topic: "レポート構成の相談",
    category: "課題・レポート",
    aiRole: "先生",
    aiScreenTimeMinutes: 24,
    gained: "論点の整理",
    feelingBefore: "焦り",
    feelingAfter: "見通し",
    distanceLevel: "ほどよい",
    selfDecision: "導入は自分の体験から書く",
    thoughtBalance: "書く順番が決まった",
  },
  {
    id: "R-20260628-003",
    date: "2026-06-28",
    time: "18:20",
    topic: "友人への返信文を考える",
    category: "人間関係",
    aiRole: "鏡",
    aiScreenTimeMinutes: 12,
    gained: "言い方の調整",
    feelingBefore: "もやもや",
    feelingAfter: "落ち着き",
    distanceLevel: "ほどよい",
    selfDecision: "短く正直に伝える",
    thoughtBalance: "相手への配慮を残せた",
  },
  {
    id: "R-20260627-004",
    date: "2026-06-27",
    time: "16:10",
    topic: "インターン先の選び方",
    category: "進路・将来",
    aiRole: "相談役",
    aiScreenTimeMinutes: 31,
    gained: "比較軸",
    feelingBefore: "不安",
    feelingAfter: "前向き",
    distanceLevel: "じっくり",
    selfDecision: "今週は2社だけ深く調べる",
    thoughtBalance: "優先順位が見えた",
  },
  {
    id: "R-20260625-005",
    date: "2026-06-25",
    time: "09:45",
    topic: "プレゼン原稿の言い換え",
    category: "文章作成",
    aiRole: "助手",
    aiScreenTimeMinutes: 16,
    gained: "表現の候補",
    feelingBefore: "硬さ",
    feelingAfter: "自然",
    distanceLevel: "ほどよい",
    selfDecision: "最後の一文は自分の言葉に戻す",
    thoughtBalance: "伝えたい温度が残った",
  },
  {
    id: "R-20260623-006",
    date: "2026-06-23",
    time: "22:15",
    topic: "眠る前の気持ちを整理",
    category: "感情整理",
    aiRole: "カウンセラー",
    aiScreenTimeMinutes: 21,
    gained: "気持ちの変化",
    feelingBefore: "疲れ",
    feelingAfter: "安心",
    distanceLevel: "近め",
    selfDecision: "明日の朝に考え直す",
    thoughtBalance: "今日の自分を責めずに終えた",
  },
  {
    id: "R-20260621-007",
    date: "2026-06-21",
    time: "14:00",
    topic: "新しいサービス事例を調べる",
    category: "調べもの",
    aiRole: "助手",
    aiScreenTimeMinutes: 27,
    gained: "比較メモ",
    feelingBefore: "散らかり",
    feelingAfter: "整理",
    distanceLevel: "ほどよい",
    selfDecision: "参考にする点を3つに絞る",
    thoughtBalance: "情報が帳簿に収まった",
  },
  {
    id: "R-20260618-008",
    date: "2026-06-18",
    time: "12:40",
    topic: "買うか迷っている教材の相談",
    category: "日常判断",
    aiRole: "親友",
    aiScreenTimeMinutes: 9,
    gained: "判断材料",
    feelingBefore: "迷い",
    feelingAfter: "保留",
    distanceLevel: "ほどよい",
    selfDecision: "来週まで買わずに様子を見る",
    thoughtBalance: "急がない選択ができた",
  },
  {
    id: "R-20260614-009",
    date: "2026-06-14",
    time: "20:10",
    topic: "企画タイトル案を出す",
    category: "企画・制作",
    aiRole: "相棒",
    aiScreenTimeMinutes: 34,
    gained: "発想の広がり",
    feelingBefore: "停滞",
    feelingAfter: "わくわく",
    distanceLevel: "近め",
    selfDecision: "応募名は自分で最終決定する",
    thoughtBalance: "候補と判断理由が残った",
  },
  {
    id: "R-20260610-010",
    date: "2026-06-10",
    time: "08:25",
    topic: "ゼミで話す内容の確認",
    category: "課題・レポート",
    aiRole: "先生",
    aiScreenTimeMinutes: 15,
    gained: "要点確認",
    feelingBefore: "緊張",
    feelingAfter: "準備完了",
    distanceLevel: "ほどよい",
    selfDecision: "結論を先に話す",
    thoughtBalance: "説明の軸ができた",
  },
];

const sampleScannedReceipt: ThoughtReceipt = {
  id: "R-20260701-001",
  date: "2026-07-01",
  time: "22:10",
  topic: "アプリの機能追加について相談",
  category: "企画・制作",
  aiRole: "相談役",
  aiScreenTimeMinutes: 22,
  gained: "実装手順の整理",
  feelingBefore: "少し不安",
  feelingAfter: "見通しが立った",
  distanceLevel: "近め",
  selfDecision: "まずは読み取り機能から追加する",
  thoughtBalance: "一気に作らず、段階的に進める方針が決まった",
};

const previousSettlement = {
  title: "5月の思考決算書",
  status: "完成済み",
  description:
    "5月に記録された思考レシートから、AIとの関わり方と自分に残った判断をまとめました。",
  summary:
    "5月は、課題・レポートと文章作成の相談が中心でした。AIには先生や助手の役割を求める場面が多く、考えを整えてから自分の言葉で提出物に落とし込む流れが残っています。",
  metrics: [
    { label: "AIスクリーンタイム", value: "2時間53分" },
    { label: "思考レシート", value: "9枚" },
    { label: "主要相談科目", value: "課題・レポート" },
    { label: "よく求めた役割", value: "先生" },
  ],
  balances: [
    "自己判断残高：8件",
    "思考収入：論点整理、文章化、見通し",
    "気持ちの変化：5件",
  ],
};

const baseMonthlyScreenTime = [
  { month: "2月", minutes: 138 },
  { month: "3月", minutes: 164 },
  { month: "4月", minutes: 196 },
  { month: "5月", minutes: 173 },
];

const moodFlow = [
  { label: "6/10", score: 62 },
  { label: "6/14", score: 78 },
  { label: "6/18", score: 58 },
  { label: "6/23", score: 74 },
  { label: "6/27", score: 82 },
  { label: "6/30", score: 88 },
];

const tabLabels: Record<TabKey, string> = {
  home: "ホーム",
  analysis: "分析",
  receipts: "レシート",
};

type ReaderStep = "closed" | "scan" | "confirm";
type AnalysisFocus = "analysis-screen-time" | null;

function resetPageScroll(behavior: ScrollBehavior = "auto", extraElement?: HTMLElement | null) {
  if (typeof window === "undefined") return;

  const candidates = [
    extraElement,
    document.querySelector(".screen"),
    document.querySelector(".phone-frame"),
    document.querySelector(".app-shell"),
    document.querySelector("main"),
    document.scrollingElement,
    document.documentElement,
    document.body,
  ].filter((element): element is HTMLElement => element instanceof HTMLElement);

  const elements = Array.from(new Set(candidates));
  const reset = () => {
    elements.forEach((element) => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
      element.scrollTo({ top: 0, left: 0, behavior });
    });
    window.scrollTo({ top: 0, left: 0, behavior });
  };

  reset();
  window.setTimeout(reset, 0);
  window.setTimeout(reset, 80);
  window.requestAnimationFrame(() => {
    reset();
    window.requestAnimationFrame(reset);
  });
}

function App() {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [receiptData, setReceiptData] = useState<ThoughtReceipt[]>(loadReceipts);
  const [readerStep, setReaderStep] = useState<ReaderStep>("closed");
  const [scannedReceipt, setScannedReceipt] = useState<ThoughtReceipt | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<ThoughtReceipt | null>(null);
  const [receiptFilter, setReceiptFilter] = useState<ReceiptFilter | null>(null);
  const [filterOrigin, setFilterOrigin] = useState<TabKey | null>(null);
  const [analysisFocus, setAnalysisFocus] = useState<AnalysisFocus>(null);
  const [isSettlementOpen, setIsSettlementOpen] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [highlightedReceiptId, setHighlightedReceiptId] = useState<string | null>(null);
  const stats = useMemo(() => buildStats(receiptData), [receiptData]);
  const settlementStats = useMemo(() => buildSettlementStats(receiptData), [receiptData]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(receiptData));
    } catch {
      // 保存できない環境でも、画面上の追加体験はそのまま使えます。
    }
  }, [receiptData]);

  useEffect(() => {
    if (activeTab !== "analysis" || !analysisFocus) return;

    window.setTimeout(() => {
      document.getElementById(analysisFocus)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      setAnalysisFocus(null);
    }, 80);
  }, [activeTab, analysisFocus]);

  function openReader() {
    setIsSettlementOpen(false);
    setActiveTab("home");
    setReaderStep("scan");
    setScannedReceipt(null);
    setSaveMessage("");
    scrollScreenToTop("auto");
  }

  function closeReader() {
    setReaderStep("closed");
    setScannedReceipt(null);
    setActiveTab("home");
    scrollScreenToTop("auto");
  }

  function loadSampleReceipt() {
    setScannedReceipt(sampleScannedReceipt);
    setReaderStep("confirm");
    scrollScreenToTop("auto");
  }

  function backToReaderScan() {
    setReaderStep("scan");
    scrollScreenToTop("auto");
  }

  function saveScannedReceipt() {
    if (!scannedReceipt) return;

    setReceiptData((current) => {
      const exists = current.some((receipt) => receipt.id === scannedReceipt.id);
      return exists ? current : [scannedReceipt, ...current];
    });
    setReaderStep("closed");
    setScannedReceipt(null);
    setReceiptFilter(null);
    setFilterOrigin(null);
    setHighlightedReceiptId(scannedReceipt.id);
    setIsSettlementOpen(false);
    setActiveTab("home");
    setSaveMessage(
      "思考レシートを帳簿に保存しました。ホームの振り返りに反映されました。",
    );
    showToast("思考帳簿に保存しました。ホームの記録に反映されました。");
    scrollScreenToTop("auto");
    window.setTimeout(() => {
      setSaveMessage("");
      setHighlightedReceiptId(null);
    }, 5000);
  }

  function showReceipts(filter: ReceiptFilter | null = null) {
    setIsSettlementOpen(false);
    setReceiptFilter(filter);
    setFilterOrigin(filter ? activeTab : null);
    setActiveTab("receipts");
    setSaveMessage("");
    scrollScreenToTop("auto");
  }

  function showAnalysis(focus: AnalysisFocus = null) {
    setIsSettlementOpen(false);
    setActiveTab("analysis");
    setAnalysisFocus(focus);
    if (!focus) scrollScreenToTop("auto");
  }

  function clearReceiptFilter() {
    setReceiptFilter(null);
    setFilterOrigin(null);
    scrollScreenToTop("auto");
  }

  function returnFromFilter() {
    const target = filterOrigin;
    setReceiptFilter(null);
    setFilterOrigin(null);
    setSaveMessage("");

    if (target && target !== "receipts") {
      setActiveTab(target);
    }
    scrollScreenToTop("auto");
  }

  function handleTabChange(tab: TabKey) {
    setIsSettlementOpen(false);
    if (tab === "receipts") {
      setReceiptFilter(null);
      setFilterOrigin(null);
    }
    setActiveTab(tab);
    setSaveMessage("");
    setAnalysisFocus(null);
    scrollScreenToTop("auto");
  }

  function openSettlement() {
    setIsSettlementOpen(true);
    setSaveMessage("");
    setAnalysisFocus(null);
    scrollScreenToTop("auto");
  }

  function closeSettlement() {
    setIsSettlementOpen(false);
    setActiveTab("home");
    scrollScreenToTop("auto");
  }

  function scrollScreenToTop(behavior: ScrollBehavior = "auto") {
    resetPageScroll(behavior, screenRef.current);
  }

  function closeReceiptDetail() {
    setSelectedReceipt(null);
    scrollScreenToTop("auto");
  }

  function showToast(message: string) {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(""), 4200);
  }

  return (
    <div className="app-shell">
      <main className="phone-frame">
        <Header onOpenSettlement={openSettlement} />
        <div className="screen" ref={screenRef}>
          {isSettlementOpen && (
            <ThoughtSettlementScreen
              stats={settlementStats}
              onBackHome={closeSettlement}
            />
          )}
          {!isSettlementOpen && activeTab === "home" && (
            <HomeScreen
              stats={stats}
              receipts={receiptData}
              onShowAnalysis={showAnalysis}
              onShowReceipts={showReceipts}
              onStartReader={openReader}
              onOpenReceipt={setSelectedReceipt}
            />
          )}
          {!isSettlementOpen && activeTab === "analysis" && (
            <AnalysisScreen stats={stats} onShowReceipts={showReceipts} />
          )}
          {!isSettlementOpen && activeTab === "receipts" && (
            <ReceiptsScreen
              receipts={receiptData}
              filter={receiptFilter}
              filterOrigin={filterOrigin}
              highlightedReceiptId={highlightedReceiptId}
              saveMessage={saveMessage}
              onClearFilter={clearReceiptFilter}
              onReturnFromFilter={returnFromFilter}
              onOpenReceipt={setSelectedReceipt}
            />
          )}
        </div>
        <ToastMessage message={toastMessage} />
        <ReceiptReaderModal
          step={readerStep}
          receipt={scannedReceipt}
          onClose={closeReader}
          onBackToScan={backToReaderScan}
          onLoadSample={loadSampleReceipt}
          onSave={saveScannedReceipt}
        />
        <ReceiptDetailModal receipt={selectedReceipt} onClose={closeReceiptDetail} />
        <BottomNav activeTab={activeTab} onChange={handleTabChange} />
      </main>
    </div>
  );
}

function Header({ onOpenSettlement }: { onOpenSettlement: () => void }) {
  return (
    <header className="top-header">
      <div>
        <p className="eyebrow">思考帳簿アプリ</p>
        <h1>私とAIの確定申告</h1>
      </div>
      <button
        className="icon-button"
        type="button"
        aria-label="6月の思考決算を開く"
        onClick={onOpenSettlement}
      >
        <BookOpenText size={20} />
      </button>
    </header>
  );
}

function ToastMessage({ message }: { message: string }) {
  if (!message) return null;

  return (
    <div className="toast-message" role="status">
      <CheckCircle2 size={18} />
      <p>{message}</p>
    </div>
  );
}

function ThoughtSettlementScreen({
  stats,
  onBackHome,
}: {
  stats: ReturnType<typeof buildSettlementStats>;
  onBackHome: () => void;
}) {
  const [isPreviousOpen, setIsPreviousOpen] = useState(false);

  function closePreviousSettlement() {
    setIsPreviousOpen(false);
    resetPageScroll("auto");
  }

  return (
    <section className="stack settlement-screen">
      <button className="back-link" type="button" onClick={onBackHome}>
        <ArrowLeft size={16} />
        ホームに戻る
      </button>

      <section className="settlement-hero">
        <div>
          <p className="eyebrow light">思考決算</p>
          <h2>6月の思考決算</h2>
          <span className="status-pill">作成中</span>
        </div>
        <p>
          思考レシートが追加されるたびに、今月の振り返りが更新されます。
        </p>
      </section>

      <section className="settlement-paper-card">
        <SectionTitle icon={<BookOpenText size={18} />} title="今月のまとめコメント" />
        <p className="settlement-summary">{stats.summary}</p>
      </section>

      <div className="settlement-metric-grid">
        <SettlementMetric label="AIスクリーンタイム" value={formatHours(stats.totalMinutes)} />
        <SettlementMetric label="思考レシート" value={`${stats.receiptCount}枚`} />
        <SettlementMetric label="主要相談科目" value={stats.topCategory} />
        <SettlementMetric label="よく求めた役割" value={stats.topRole} />
      </div>

      <section className="settlement-paper-card">
        <SectionTitle icon={<WalletCards size={18} />} title="自分に残ったもの" />
        <div className="settlement-balance-list">
          <SettlementBalance
            title="自己判断残高"
            body={`自分の言葉で判断や気づきを残せたレシート：${stats.selfDecisionCount}件`}
          />
          <SettlementBalance
            title="思考収入"
            body={`AIとの会話から得たもの：${stats.gainedSummary}`}
          />
          <SettlementBalance
            title="気持ちの変化"
            body={`不安や迷いが、納得や見通しにつながったレシート：${stats.reframedMoodCount}件`}
          />
        </div>
        <div className="settlement-barcode" aria-hidden="true" />
      </section>

      <section className="settlement-paper-card">
        <SectionTitle icon={<ReceiptText size={18} />} title="先月の完成版サンプル" />
        <p className="settlement-muted">
          完成済みの思考決算書では、月の終わりにAIとの関わり方と自分に残った判断をまとめます。
        </p>
        <button
          className="settlement-link-button"
          type="button"
          onClick={() => setIsPreviousOpen(true)}
        >
          5月の思考決算書を見る
          <ChevronRight size={17} />
        </button>
      </section>

      <section className="settlement-year-card">
        <p className="eyebrow">年間のまとめへ</p>
        <h3>年末には「私とAIの確定申告」へ</h3>
        <p>
          月ごとの思考決算がたまると、年末に「2026年 私とAIの確定申告」としてまとめられます。
        </p>
      </section>

      <button className="secondary-action" type="button" onClick={onBackHome}>
        ホームに戻る
      </button>

      {isPreviousOpen && (
        <PreviousSettlementModal onClose={closePreviousSettlement} />
      )}
    </section>
  );
}

function SettlementMetric({ label, value }: { label: string; value: string }) {
  return (
    <article className="settlement-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function SettlementBalance({ title, body }: { title: string; body: string }) {
  return (
    <div className="settlement-balance-row">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function PreviousSettlementModal({ onClose }: { onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      modalRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, []);

  return (
    <div className="reader-backdrop" role="dialog" aria-modal="true">
      <div className="reader-modal" ref={modalRef}>
        <button className="reader-close" type="button" onClick={onClose} aria-label="閉じる">
          <X size={18} />
        </button>
        <div className="reader-panel">
          <button className="modal-back-action" type="button" onClick={onClose}>
            <ArrowLeft size={16} />
            6月の思考決算に戻る
          </button>
          <p className="eyebrow">思考決算書</p>
          <h2>{previousSettlement.title}</h2>
          <span className="status-pill complete">{previousSettlement.status}</span>
          <p className="reader-description">{previousSettlement.description}</p>
          <div className="confirm-receipt detail-receipt settlement-document">
            <div className="receipt-paper-header">
              <span>思考帳簿に保存済み</span>
              <strong>MONTH-05</strong>
            </div>
            <p className="settlement-summary">{previousSettlement.summary}</p>
            <div className="previous-metrics">
              {previousSettlement.metrics.map((metric) => (
                <SettlementMetric
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                />
              ))}
            </div>
            <div className="settlement-balance-list">
              {previousSettlement.balances.map((balance) => (
                <p className="previous-balance" key={balance}>
                  {balance}
                </p>
              ))}
            </div>
            <div className="receipt-barcode" aria-hidden="true" />
          </div>
          <button className="secondary-action" type="button" onClick={onClose}>
            6月の思考決算に戻る
          </button>
        </div>
      </div>
    </div>
  );
}

function HomeScreen({
  stats,
  receipts,
  onShowAnalysis,
  onShowReceipts,
  onStartReader,
  onOpenReceipt,
}: {
  stats: ReturnType<typeof buildStats>;
  receipts: ThoughtReceipt[];
  onShowAnalysis: (focus?: AnalysisFocus) => void;
  onShowReceipts: (filter?: ReceiptFilter | null) => void;
  onStartReader: () => void;
  onOpenReceipt: (receipt: ThoughtReceipt) => void;
}) {
  const latestReceipt = receipts[0];

  return (
    <section className="stack">
      <div className="hero-ledger">
        <div className="hero-copy">
          <p className="eyebrow light">2026年6月</p>
          <h2>今月は、企画・制作の場面でAIとの距離が近めでした。</h2>
          <p>
            AIに整理を頼る一方で、最後の判断は自分の言葉で残せています。
          </p>
        </div>
        <button
          className="hero-total pressable-surface"
          type="button"
          onClick={() => onShowAnalysis("analysis-screen-time")}
        >
          <Clock3 size={18} />
          <span>{formatHours(stats.totalMinutes)}</span>
          <small>AIスクリーンタイム</small>
          <em className="tap-hint hero-hint">見る</em>
        </button>
      </div>

      <button
        className="home-reader-card pressable-surface"
        type="button"
        onClick={onStartReader}
      >
        <span className="home-reader-icon">
          <Plus size={21} />
        </span>
        <span className="home-reader-copy">
          <strong>思考レシートを読み取る</strong>
          <small>AIとの会話を、思考帳簿に追加します。</small>
        </span>
        <ChevronRight size={20} />
      </button>

      <div className="metric-grid">
        <MetricCard
          icon={<ReceiptText size={18} />}
          label="思考レシート"
          value={`${stats.receiptCount}枚`}
          tone="blue"
          onClick={() => onShowReceipts(null)}
        />
        <MetricCard
          icon={<Coins size={18} />}
          label="今日の思考残高"
          value="納得 +3"
          tone="sky"
          onClick={() => latestReceipt && onOpenReceipt(latestReceipt)}
        />
      </div>

      <section className="card">
        <SectionTitle icon={<WalletCards size={18} />} title="今月のまとめ" />
        <div className="summary-list">
          <SummaryRow
            label="よく相談した科目"
            value={stats.topCategory}
            onClick={() =>
              onShowReceipts({ type: "category", value: stats.topCategory })
            }
          />
          <SummaryRow
            label="AIに求めた役割"
            value={stats.topRole}
            onClick={() => onShowReceipts({ type: "role", value: stats.topRole })}
          />
          <SummaryRow label="AIとの距離感" value="近め / ほどよい中心" />
          <SummaryRow
            label="自己判断残高"
            value={`${stats.selfDecisionCount}件 記録`}
            onClick={() => onShowReceipts({ type: "selfDecision" })}
          />
        </div>
      </section>

      <section className="card soft-blue">
        <SectionTitle icon={<Sparkles size={18} />} title="今月の振り返り" />
        <p className="reflection">
          今週は、気持ちを整えるためにAIを使う場面もありました。相談後の
          「自分で決めたこと」が残っているので、思考の流れをあとから見返せます。
        </p>
      </section>

      <section className="section-block">
        <SectionTitle icon={<NotebookTabs size={18} />} title="最近の思考レシート" />
        <div className="recent-list">
          {receipts.slice(0, 3).map((receipt) => (
            <MiniReceipt
              key={receipt.id}
              receipt={receipt}
              onClick={() => onOpenReceipt(receipt)}
            />
          ))}
        </div>
      </section>
    </section>
  );
}

function AnalysisScreen({
  stats,
  onShowReceipts,
}: {
  stats: ReturnType<typeof buildStats>;
  onShowReceipts: (filter: ReceiptFilter) => void;
}) {
  return (
    <section className="stack">
      <div className="analysis-header">
        <div>
          <p className="eyebrow">思考レシート集計</p>
          <h2>AIとの会話が、どんな場面で増えたかを見る</h2>
        </div>
      </div>

      <section className="card">
        <SectionTitle icon={<BarChart3 size={18} />} title="相談科目別の割合" />
        <DonutChart
          data={stats.categoryShare}
          onSelect={(value) => onShowReceipts({ type: "category", value })}
        />
      </section>

      <section className="card">
        <SectionTitle icon={<Bot size={18} />} title="AIに求めた役割" />
        <HorizontalBars
          data={stats.roleShare}
          onSelect={(value) => onShowReceipts({ type: "role", value })}
        />
      </section>

      <section className="card" id="analysis-screen-time">
        <SectionTitle icon={<Clock3 size={18} />} title="月別AIスクリーンタイム" />
        <MonthlyBars data={stats.monthlyScreenTime} />
      </section>

      <button
        className="card analysis-action-card"
        type="button"
        onClick={() => onShowReceipts({ type: "moodChange" })}
      >
        <SectionTitle icon={<LineChart size={18} />} title="気持ちの変化" />
        <span className="card-action-hint">関連レシートを見る</span>
        <LineGraph data={moodFlow} />
        <MoodInsight stats={stats} />
      </button>

      <button
        className="card balance-card analysis-action-card"
        type="button"
        onClick={() => onShowReceipts({ type: "selfDecision" })}
      >
        <SectionTitle icon={<CheckCircle2 size={18} />} title="自己判断残高" />
        <span className="card-action-hint">関連レシートを見る</span>
        <div className="balance-display">
          <strong>{stats.selfDecisionCount}</strong>
          <span>件</span>
        </div>
        <p>
          AIから受け取ったヒントを、そのまま終わらせずに自分の判断として
          残せたレシート数です。
        </p>
      </button>
    </section>
  );
}

function ReceiptsScreen({
  receipts,
  filter,
  filterOrigin,
  highlightedReceiptId,
  saveMessage,
  onClearFilter,
  onReturnFromFilter,
  onOpenReceipt,
}: {
  receipts: ThoughtReceipt[];
  filter: ReceiptFilter | null;
  filterOrigin: TabKey | null;
  highlightedReceiptId: string | null;
  saveMessage: string;
  onClearFilter: () => void;
  onReturnFromFilter: () => void;
  onOpenReceipt: (receipt: ThoughtReceipt) => void;
}) {
  const filteredReceipts = filter ? applyReceiptFilter(receipts, filter) : receipts;

  return (
    <section className="stack">
      <div className="receipt-title">
        <div>
          <p className="eyebrow">思考レシート一覧</p>
          <h2>家計簿のように、AIとの会話を振り返る</h2>
        </div>
      </div>

      {filter && (
        <button className="back-link" type="button" onClick={onReturnFromFilter}>
          <ArrowLeft size={16} />
          {getFilterBackLabel(filterOrigin)}
        </button>
      )}

      {saveMessage && (
        <div className="save-message" role="status">
          <CheckCircle2 size={18} />
          <p>{saveMessage}</p>
        </div>
      )}

      {filter && (
        <div className="filter-card">
          <div>
            <p className="eyebrow">絞り込み中</p>
            <strong>{getFilterTitle(filter)}</strong>
            <em>
              表示中 {filteredReceipts.length}件 / 全{receipts.length}件
            </em>
            <span>{getFilterDescription(filter)}</span>
          </div>
          <button type="button" onClick={onClearFilter}>
            絞り込みを解除
          </button>
        </div>
      )}

      <div className="receipt-ledger">
        {filteredReceipts.map((receipt) => (
          <ReceiptRow
            key={receipt.id}
            receipt={receipt}
            isHighlighted={receipt.id === highlightedReceiptId}
            onClick={() => onOpenReceipt(receipt)}
          />
        ))}
      </div>

      {filter && filteredReceipts.length > 0 && (
        <div className="bottom-return-card">
          <button type="button" onClick={onReturnFromFilter}>
            {getBottomReturnLabel(filterOrigin)}
          </button>
        </div>
      )}

      {filteredReceipts.length === 0 && (
        <section className="card empty-state">
          <SectionTitle icon={<ReceiptText size={18} />} title="該当するレシートはまだありません" />
          <p>絞り込みを解除すると、すべての思考レシートを見られます。</p>
        </section>
      )}
    </section>
  );
}

function ReceiptReaderModal({
  step,
  receipt,
  onClose,
  onBackToScan,
  onLoadSample,
  onSave,
}: {
  step: ReaderStep;
  receipt: ThoughtReceipt | null;
  onClose: () => void;
  onBackToScan: () => void;
  onLoadSample: () => void;
  onSave: () => void;
}) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (step === "closed") return;
    window.requestAnimationFrame(() => {
      modalRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, [step]);

  if (step === "closed") return null;

  return (
    <div className="reader-backdrop" role="dialog" aria-modal="true">
      <div className="reader-modal" ref={modalRef}>
        <button className="reader-close" type="button" onClick={onClose} aria-label="閉じる">
          <X size={18} />
        </button>

        {step === "scan" && (
          <div className="reader-panel">
            <p className="eyebrow">思考レシート読み取り</p>
            <h2>思考レシートを読み取る</h2>
            <p className="reader-description">
              今回はプロトタイプとして、サンプルレシートを読み込んで思考帳簿に追加します。
            </p>
            <div className="scan-area">
              <div className="scan-corner top-left" />
              <div className="scan-corner top-right" />
              <div className="scan-corner bottom-left" />
              <div className="scan-corner bottom-right" />
              <ReceiptText size={34} />
              <strong>レシート下部のQRコードを読み取ってください</strong>
              <p>今回はプロトタイプのため、サンプルレシートを読み込みます。</p>
            </div>
            <button className="primary-action" type="button" onClick={onLoadSample}>
              <ScanLine size={18} />
              サンプルレシートを読み込む
            </button>
            <button className="secondary-action" type="button" onClick={onClose}>
              閉じる
            </button>
          </div>
        )}

        {step === "confirm" && receipt && (
          <div className="reader-panel">
            <button className="modal-back-action" type="button" onClick={onBackToScan}>
              <ArrowLeft size={16} />
              読み取りに戻る
            </button>
            <p className="eyebrow">読み取り確認</p>
            <h2>読み取り内容の確認</h2>
            <p className="reader-description">
              読み取った思考レシートを確認してください。必要に応じて内容を見直してから、思考帳簿に保存できます。
            </p>
            <div className="confirm-receipt">
              <ConfirmRow label="日付" value={receipt.date} />
              <ConfirmRow label="時間" value={receipt.time} />
              <ConfirmRow label="相談テーマ" value={receipt.topic} />
              <ConfirmRow label="相談科目" value={receipt.category} />
              <ConfirmRow label="AIに求めた役割" value={receipt.aiRole} />
              <ConfirmRow label="AIスクリーンタイム" value={`${receipt.aiScreenTimeMinutes}分`} />
              <ConfirmRow label="思考収入" value={receipt.gained} />
              <ConfirmRow label="会話前の気持ち" value={receipt.feelingBefore} />
              <ConfirmRow label="会話後の気持ち" value={receipt.feelingAfter} />
              <ConfirmRow label="AIとの距離感" value={receipt.distanceLevel} />
              <ConfirmRow label="自分で決めたこと" value={receipt.selfDecision} />
              <ConfirmRow label="思考残高" value={receipt.thoughtBalance} />
            </div>
            <button className="primary-action" type="button" onClick={onSave}>
              <CheckCircle2 size={18} />
              思考帳簿に保存
            </button>
            <button className="secondary-action" type="button" onClick={onClose}>
              保存せず戻る
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="confirm-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReceiptDetailModal({
  receipt,
  onClose,
}: {
  receipt: ThoughtReceipt | null;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!receipt) return;
    window.requestAnimationFrame(() => {
      modalRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, [receipt]);

  if (!receipt) return null;

  return (
    <div className="reader-backdrop" role="dialog" aria-modal="true">
      <div className="reader-modal" ref={modalRef}>
        <button className="reader-close" type="button" onClick={onClose} aria-label="閉じる">
          <X size={18} />
        </button>
        <div className="reader-panel">
          <button className="modal-back-action" type="button" onClick={onClose}>
            <ArrowLeft size={16} />
            一覧に戻る
          </button>
          <p className="eyebrow">思考レシート詳細</p>
          <h2>{receipt.topic}</h2>
          <p className="reader-description">
            AIとの会話の前後で、何を受け取り、最後に自分の言葉で何を残したかを振り返れます。
          </p>
          <div className="detail-note">
            <BookOpenText size={18} />
            <span>{formatDate(receipt.date)} {receipt.time} の思考記録</span>
          </div>
          <div className="confirm-receipt detail-receipt">
            <div className="receipt-paper-header">
              <span>思考帳簿に保存済み</span>
              <strong>{receipt.id}</strong>
            </div>
            <ConfirmRow label="日付" value={receipt.date} />
            <ConfirmRow label="時間" value={receipt.time} />
            <ConfirmRow label="相談テーマ" value={receipt.topic} />
            <ConfirmRow label="相談科目" value={receipt.category} />
            <ConfirmRow label="AIに求めた役割" value={receipt.aiRole} />
            <ConfirmRow label="AIスクリーンタイム" value={`${receipt.aiScreenTimeMinutes}分`} />
            <ConfirmRow label="思考収入" value={receipt.gained} />
            <ConfirmRow label="会話前の気持ち" value={receipt.feelingBefore} />
            <ConfirmRow label="会話後の気持ち" value={receipt.feelingAfter} />
            <ConfirmRow label="AIとの距離感" value={receipt.distanceLevel} />
            <ConfirmRow label="自分で決めたこと" value={receipt.selfDecision} />
            <ConfirmRow label="思考残高" value={receipt.thoughtBalance} />
            <div className="receipt-barcode" aria-hidden="true" />
          </div>
          <button className="secondary-action" type="button" onClick={onClose}>
            一覧に戻る
          </button>
        </div>
      </div>
    </div>
  );
}

function BottomNav({
  activeTab,
  onChange,
}: {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  const tabs: Array<{ key: TabKey; icon: ReactNode }> = [
    { key: "home", icon: <Home size={20} /> },
    { key: "analysis", icon: <BarChart3 size={20} /> },
    { key: "receipts", icon: <ReceiptText size={20} /> },
  ];

  return (
    <nav className="bottom-nav" aria-label="画面切り替え">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={activeTab === tab.key ? "active" : ""}
          type="button"
          onClick={() => onChange(tab.key)}
        >
          {tab.icon}
          <span>{tabLabels[tab.key]}</span>
        </button>
      ))}
    </nav>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "blue" | "sky";
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      {onClick && <small className="tap-hint">見る</small>}
    </>
  );

  if (onClick) {
    return (
      <button className={`metric-card ${tone} pressable-surface`} type="button" onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <article className={`metric-card ${tone}`}>
      {content}
    </article>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="section-title">
      <span>{icon}</span>
      <h3>{title}</h3>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  );

  if (onClick) {
    return (
      <button className="summary-row pressable-row" type="button" onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <div className="summary-row">
      {content}
    </div>
  );
}

function MiniReceipt({
  receipt,
  onClick,
}: {
  receipt: ThoughtReceipt;
  onClick?: () => void;
}) {
  return (
    <button className="mini-receipt pressable-surface" type="button" onClick={onClick}>
      <div>
        <span className="date">{formatDate(receipt.date)}</span>
        <strong>{receipt.topic}</strong>
        <p>
          {receipt.category} / {receipt.aiRole}
        </p>
      </div>
      <ChevronRight size={18} />
    </button>
  );
}

function ReceiptRow({
  receipt,
  isHighlighted,
  onClick,
}: {
  receipt: ThoughtReceipt;
  isHighlighted: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`receipt-row pressable-receipt ${isHighlighted ? "new-receipt" : ""}`}
      type="button"
      onClick={onClick}
    >
      <div className="receipt-topline">
        <div>
          <span className="date">
            {formatDate(receipt.date)} {receipt.time}
          </span>
          <h3>{receipt.topic}</h3>
        </div>
        <div className="receipt-actions">
          {isHighlighted && <span className="new-pill">追加されました</span>}
          <span className="distance-pill">{receipt.distanceLevel}</span>
          <span className="detail-pill">詳細</span>
        </div>
      </div>

      <div className="receipt-meta">
        <span>{receipt.category}</span>
        <span>{receipt.aiRole}</span>
        <span>{receipt.aiScreenTimeMinutes}分</span>
      </div>

      <div className="ledger-lines">
        <LedgerLine label="思考収入" value={receipt.gained} />
        <LedgerLine
          label="会話後の気持ち"
          value={`${receipt.feelingBefore} → ${receipt.feelingAfter}`}
        />
        <LedgerLine label="自己判断" value={receipt.selfDecision} />
        <LedgerLine label="思考残高" value={receipt.thoughtBalance} />
      </div>
    </button>
  );
}

function LedgerLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="ledger-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DonutChart({
  data,
  onSelect,
}: {
  data: Array<{ label: string; value: number; color: string }>;
  onSelect?: (label: string) => void;
}) {
  let offset = 25;
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="donut-layout">
      <svg viewBox="0 0 42 42" className="donut" aria-label="相談科目別の割合">
        <circle cx="21" cy="21" r="15.915" className="donut-base" />
        {data.map((item) => {
          const dash = (item.value / total) * 100;
          const circle = (
            <circle
              key={item.label}
              cx="21"
              cy="21"
              r="15.915"
              className="donut-segment"
              stroke={item.color}
              strokeDasharray={`${dash} ${100 - dash}`}
              strokeDashoffset={offset}
            />
          );
          offset -= dash;
          return circle;
        })}
        <text x="21" y="20.4" textAnchor="middle" className="donut-number">
          {total}
        </text>
        <text x="21" y="25.3" textAnchor="middle" className="donut-label">
          枚
        </text>
      </svg>
      <div className="legend-list">
        {data.map((item) => (
          <button
            className="legend-row pressable-row"
            key={item.label}
            type="button"
            onClick={() => onSelect?.(item.label)}
          >
            <span style={{ backgroundColor: item.color }} />
            <p>{item.label}</p>
            <strong>{Math.round((item.value / total) * 100)}%</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

function HorizontalBars({
  data,
  onSelect,
}: {
  data: Array<{ label: string; value: number; color: string }>;
  onSelect?: (label: string) => void;
}) {
  const max = Math.max(...data.map((item) => item.value));

  return (
    <div className="bar-list">
      {data.map((item) => (
        <button
          className="bar-row pressable-row"
          key={item.label}
          type="button"
          onClick={() => onSelect?.(item.label)}
        >
          <div className="bar-label">
            <span>{item.label}</span>
            <div className="bar-value-group">
              <small>見る</small>
              <strong>{item.value}回</strong>
            </div>
          </div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${(item.value / max) * 100}%`, backgroundColor: item.color }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}

function MonthlyBars({ data }: { data: Array<{ month: string; minutes: number }> }) {
  const max = Math.max(...data.map((item) => item.minutes));

  return (
    <div className="monthly-bars">
      {data.map((item) => (
        <div className="month-col" key={item.month}>
          <div className="month-bar-wrap">
            <div
              className="month-bar"
              style={{ height: `${(item.minutes / max) * 100}%` }}
            />
          </div>
          <span>{item.month}</span>
          <strong>{item.minutes}</strong>
        </div>
      ))}
    </div>
  );
}

function LineGraph({ data }: { data: Array<{ label: string; score: number }> }) {
  const width = 300;
  const height = 130;
  const points = data.map((item, index) => {
    const x = 18 + (index * (width - 36)) / (data.length - 1);
    const y = height - 18 - (item.score / 100) * (height - 36);
    return { ...item, x, y };
  });
  const d = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  return (
    <div className="line-card">
      <svg viewBox={`0 0 ${width} ${height}`} aria-label="気持ちの変化">
        <path className="line-grid" d="M18 34 H282 M18 70 H282 M18 106 H282" />
        <path className="line-path" d={d} />
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="4.5" />
            <text x={point.x} y="124" textAnchor="middle">
              {point.label}
            </text>
          </g>
        ))}
      </svg>
      <p>会話後に「納得」「安心」「前向き」が増えている流れです。</p>
    </div>
  );
}

function MoodInsight({ stats }: { stats: ReturnType<typeof buildStats> }) {
  return (
    <div className="mood-insight">
      <div>
        <span>気持ちの変化</span>
        <strong>{stats.moodChangeCount}件</strong>
      </div>
      <div>
        <span>会話前に多かった気持ち</span>
        <strong>{stats.topFeelingBefore}</strong>
      </div>
      <div>
        <span>会話後に多かった気持ち</span>
        <strong>{stats.topFeelingAfter}</strong>
      </div>
      <div>
        <span>見通しにつながった記録</span>
        <strong>{stats.reframedMoodCount}件</strong>
      </div>
      <p>
        AIとの会話の前後で、気持ちがどのように動いたかを記録します。
        不安や迷いが、納得や見通しにつながったレシートを振り返れます。
      </p>
    </div>
  );
}

function buildSettlementStats(data: ThoughtReceipt[]) {
  const juneReceipts = data.filter((receipt) => receipt.date.startsWith("2026-06"));
  const targetReceipts = juneReceipts.length > 0 ? juneReceipts : data;
  const totalMinutes = targetReceipts.reduce(
    (sum, item) => sum + item.aiScreenTimeMinutes,
    0,
  );
  const categoryCounts = countBy(targetReceipts, "category");
  const roleCounts = countBy(targetReceipts, "aiRole");
  const topCategory = topCountLabel(categoryCounts);
  const topRole = topCountLabel(roleCounts);
  const selfDecisionCount = targetReceipts.filter(hasSelfDecisionBalance).length;
  const moodChangeCount = targetReceipts.filter(hasMoodChange).length;
  const reframedMoodCount = targetReceipts.filter(isReframedMoodChange).length;
  const gainedSummary = topCountLabels(countBy(targetReceipts, "gained"), 3).join("、");
  const distanceText = getDistanceSummary(targetReceipts);

  return {
    totalMinutes,
    receiptCount: targetReceipts.length,
    topCategory,
    topRole,
    selfDecisionCount,
    moodChangeCount,
    reframedMoodCount,
    gainedSummary,
    summary: `今月は、${topCategory}の相談が多く、AIを「${topRole}」として使う場面が目立ちました。AIとの距離は${distanceText}でしたが、自己判断残高も${selfDecisionCount}件あり、自分の言葉で判断を残せています。気持ちの変化が見られたレシートは${moodChangeCount}件でした。`,
  };
}

// サンプル配列を集計して、ホームと分析画面で使う数字に変換します。
function buildStats(data: ThoughtReceipt[]) {
  const totalMinutes = data.reduce((sum, item) => sum + item.aiScreenTimeMinutes, 0);
  const categoryCounts = countBy(data, "category");
  const roleCounts = countBy(data, "aiRole");
  const feelingBeforeCounts = countBy(data, "feelingBefore");
  const feelingAfterCounts = countBy(data, "feelingAfter");
  const moodChangeReceipts = data.filter(hasMoodChange);
  const reframedMoodCount = data.filter(isReframedMoodChange).length;
  const colors = [
    "#2563EB",
    "#38BDF8",
    "#0EA5E9",
    "#93C5FD",
    "#7DD3FC",
    "#60A5FA",
    "#BAE6FD",
    "#1D4ED8",
  ];

  const categoryShare = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], index) => ({ label, value, color: colors[index] }));

  const roleShare = Object.entries(roleCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], index) => ({ label, value, color: colors[index] }));

  return {
    totalMinutes,
    receiptCount: data.length,
    selfDecisionCount: data.filter((item) => item.selfDecision).length,
    topCategory: categoryShare[0]?.label ?? "-",
    topRole: roleShare[0]?.label ?? "-",
    categoryShare,
    roleShare,
    monthlyScreenTime: buildMonthlyScreenTime(data),
    moodChangeCount: moodChangeReceipts.length,
    topFeelingBefore: topCountLabel(feelingBeforeCounts),
    topFeelingAfter: topCountLabel(feelingAfterCounts),
    reframedMoodCount,
  };
}

function buildMonthlyScreenTime(data: ThoughtReceipt[]) {
  const receiptMonths = data.reduce<Record<string, number>>((acc, receipt) => {
    const [, month] = receipt.date.split("-");
    const label = `${Number(month)}月`;
    acc[label] = (acc[label] ?? 0) + receipt.aiScreenTimeMinutes;
    return acc;
  }, {});

  const baseMonths = new Set(baseMonthlyScreenTime.map((item) => item.month));
  const dynamicMonths = Object.entries(receiptMonths)
    .filter(([month]) => !baseMonths.has(month))
    .map(([month, minutes]) => ({ month, minutes }))
    .sort((a, b) => Number(a.month.replace("月", "")) - Number(b.month.replace("月", "")));

  return [
    ...baseMonthlyScreenTime,
    ...dynamicMonths,
  ];
}

function applyReceiptFilter(data: ThoughtReceipt[], filter: ReceiptFilter) {
  switch (filter.type) {
    case "category":
      return data.filter((receipt) => receipt.category === filter.value);
    case "role":
      return data.filter((receipt) => receipt.aiRole === filter.value);
    case "moodChange":
      return data.filter(hasMoodChange);
    case "selfDecision":
      return data.filter(hasSelfDecisionBalance);
  }
}

function getFilterTitle(filter: ReceiptFilter) {
  switch (filter.type) {
    case "category":
      return `相談科目：${filter.value} のレシート`;
    case "role":
      return `AIに求めた役割：${filter.value} のレシート`;
    case "moodChange":
      return "気持ちの変化があったレシート";
    case "selfDecision":
      return "自己判断残高があるレシート";
  }
}

function getFilterDescription(filter: ReceiptFilter) {
  switch (filter.type) {
    case "category":
      return "同じ相談科目の思考レシートをまとめて見ています。";
    case "role":
      return "AIに同じ役割を求めた会話を振り返れます。";
    case "moodChange":
      return "AIとの会話の前後で、気持ちが動いた記録です。";
    case "selfDecision":
      return "AIからヒントを得たあと、自分の言葉で判断や気づきを残せたレシートです。";
  }
}

function getFilterBackLabel(origin: TabKey | null) {
  if (origin === "analysis") return "分析に戻る";
  if (origin === "home") return "ホームに戻る";
  return "すべてのレシートに戻る";
}

function getBottomReturnLabel(origin: TabKey | null) {
  if (origin === "analysis") return "分析画面に戻る";
  if (origin === "home") return "ホームに戻る";
  return "すべてのレシートに戻る";
}

function hasMoodChange(receipt: ThoughtReceipt) {
  return receipt.feelingBefore.trim() !== receipt.feelingAfter.trim();
}

function hasSelfDecisionBalance(receipt: ThoughtReceipt) {
  return Boolean(receipt.selfDecision.trim() || receipt.thoughtBalance.trim());
}

function isReframedMoodChange(receipt: ThoughtReceipt) {
  const beforeKeywords = ["不安", "迷い", "焦り", "もやもや", "少し不安"];
  const afterKeywords = ["安心", "納得", "見通し", "すっきり", "落ち着き", "前向き"];

  return (
    beforeKeywords.some((keyword) => receipt.feelingBefore.includes(keyword)) &&
    afterKeywords.some((keyword) => receipt.feelingAfter.includes(keyword))
  );
}

function topCountLabel(counts: Record<string, number>) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
}

function topCountLabels(counts: Record<string, number>, limit: number) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label]) => label);
}

function getDistanceSummary(data: ThoughtReceipt[]) {
  const label = topCountLabel(countBy(data, "distanceLevel"));
  return label === "-" ? "ほどよい中心" : label;
}

function loadReceipts() {
  if (typeof window === "undefined") return initialReceipts;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return initialReceipts;
    const parsed = JSON.parse(stored) as ThoughtReceipt[];
    if (!Array.isArray(parsed)) return initialReceipts;
    return parsed.map(normalizeReceipt);
  } catch {
    return initialReceipts;
  }
}

function normalizeReceipt(receipt: ThoughtReceipt): ThoughtReceipt {
  const legacyAdvisorRole = "\u53c2\u8b00";
  const legacyMoodGain = "\u5b89\u5fc3\u9084\u4ed8";

  return {
    ...receipt,
    aiRole: receipt.aiRole === legacyAdvisorRole ? "相談役" : receipt.aiRole,
    gained: receipt.gained === legacyMoodGain ? "気持ちの変化" : receipt.gained,
  };
}

function countBy<T extends keyof ThoughtReceipt>(data: ThoughtReceipt[], key: T) {
  return data.reduce<Record<string, number>>((acc, item) => {
    const value = String(item[key]);
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function formatHours(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}時間${rest}分`;
}

function formatDate(date: string) {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

export default App;
