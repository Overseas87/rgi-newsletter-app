import React, { useState } from "react";
import {
  LayoutDashboard,
  Newspaper,
  List,
  Clock,
  CheckCircle,
  XCircle,
  Database,
  Settings,
  Info,
  PenTool,
  Search,
  Bell,
  Tag,
  Download,
  BookOpen,
  ArrowRight,
} from "lucide-react";

const SIDEBAR_NAV = [
  { name: "Generate Brief", icon: PenTool, active: false, highlight: true },
  { name: "Dashboard", icon: LayoutDashboard, active: true, highlight: false },
  { name: "Intelligence Feed", icon: Newspaper, active: false, highlight: false },
  { name: "Today's Topics", icon: List, active: false, highlight: false },
  { name: "Pending Review", icon: Clock, active: false, highlight: false },
  { name: "Published", icon: CheckCircle, active: false, highlight: false },
  { name: "Rejected", icon: XCircle, active: false, highlight: false },
  { type: "separator" },
  { name: "Sources", icon: Database, active: false, highlight: false },
  { name: "Settings", icon: Settings, active: false, highlight: false },
  { name: "About RGI", icon: Info, active: false, highlight: false },
];

const TOP_STORIES = [
  {
    id: "01",
    headline: "Strait of Hormuz Tensions Escalate as Commercial Shipping Reroutes",
    source: "Foreign Affairs",
    time: "2 hours ago",
    summary: "Recent naval exercises in the Gulf have prompted major shipping conglomerates to announce temporary rerouting of oil tankers, causing a spike in global energy futures.",
    tags: ["Geopolitics", "Energy Markets"],
    score: "9.8",
  },
  {
    id: "02",
    headline: "Central Banks Signal Coordinated Pause on Interest Rate Hikes",
    source: "Financial Times",
    time: "4 hours ago",
    summary: "In an unexpected joint statement, top central bank governors indicated a holding pattern for Q3, citing stabilizing inflation metrics across developed economies.",
    tags: ["Finance & Markets", "Macroeconomics"],
    score: "9.5",
  },
  {
    id: "03",
    headline: "Semiconductor Supply Chain Faces New Export Restrictions",
    source: "Wall Street Journal",
    time: "5 hours ago",
    summary: "New policy frameworks introduced overnight will limit the export of advanced lithography equipment, threatening to tighten the global supply of next-generation chips.",
    tags: ["Technology", "Trade Policy"],
    score: "9.2",
  },
  {
    id: "04",
    headline: "Emerging Markets Debt Restructuring Talks Reach Impasse",
    source: "Bloomberg",
    time: "7 hours ago",
    summary: "Creditor committees and sovereign representatives failed to reach a consensus on haircut percentages, delaying critical IMF disbursements for three key nations.",
    tags: ["Global Economy", "Sovereign Debt"],
    score: "8.9",
  },
];

const WHAT_MATTERS = [
  { rank: "1", topic: "Middle East Maritime Security", sources: 42, score: "9.7" },
  { rank: "2", topic: "Global Monetary Policy Shift", sources: 38, score: "9.4" },
  { rank: "3", topic: "Tech Export Controls", sources: 29, score: "9.1" },
  { rank: "4", topic: "Sovereign Debt Crises", sources: 21, score: "8.8" },
  { rank: "5", topic: "European Energy Reserves", sources: 18, score: "8.5" },
];

export function Dashboard() {
  const [activeNav, setActiveNav] = useState("Dashboard");

  return (
    <div className="flex h-screen w-full bg-[#FFFFFF] font-sans text-[#1A1A2E] overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[240px] flex-shrink-0 bg-[#0B1F3A] flex flex-col border-r border-[#0B1F3A]">
        {/* Logo Area */}
        <div className="h-16 flex items-center px-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img
              src="/__mockup/images/rgi-logo-transparent.png"
              alt="RGI"
              className="h-8 w-8 object-contain flex-shrink-0"
            />
            <div className="flex flex-col leading-tight">
              <span className="text-white font-['Playfair_Display'] font-semibold text-[13px] tracking-wide">
                Rick Goings Institute
              </span>
              <span className="text-white/45 text-[9px] uppercase tracking-widest">
                Strategic Intelligence
              </span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-6 flex flex-col gap-1 px-3">
          {SIDEBAR_NAV.map((item, index) => {
            if (item.type === "separator") {
              return <div key={`sep-${index}`} className="h-px bg-white/10 my-4 mx-3" />;
            }

            const isActive = activeNav === item.name;
            const isHighlight = item.highlight;

            return (
              <button
                key={item.name}
                onClick={() => setActiveNav(item.name || "")}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all ${
                  isHighlight
                    ? "bg-[#C09A3A] text-[#0B1F3A] hover:bg-[#D4AF4E]"
                    : isActive
                    ? "bg-white/10 text-white border-l-2 border-[#C09A3A]"
                    : "text-white/70 hover:bg-white/5 hover:text-white"
                }`}
              >
                {item.icon && <item.icon className={`w-4 h-4 ${isHighlight ? "text-[#0B1F3A]" : (isActive ? "text-[#C09A3A]" : "text-white/50")}`} />}
                {item.name}
              </button>
            );
          })}
        </nav>

        {/* User profile minimal */}
        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs text-white">
              ED
            </div>
            <div className="flex flex-col text-left">
              <span className="text-white text-sm font-medium">Editor Desk</span>
              <span className="text-white/50 text-xs">admin@rgi.edu</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#FFFFFF]">
        {/* Topbar */}
        <header className="h-16 flex-shrink-0 border-b border-[#F0F0F0] flex items-center justify-between px-8 bg-white z-10">
          <div className="flex items-center gap-4">
            <h1 className="font-['Playfair_Display'] text-2xl font-bold text-[#1A1A2E]">
              {activeNav}
            </h1>
            <span className="text-sm text-[#6B7280] font-medium tracking-wide uppercase mt-1">
              October 24, 2026
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#0B1F3A] border border-[#0B1F3A] rounded hover:bg-[#F0F0F0] transition-colors">
              <Download className="w-4 h-4" />
              Scrape Now
            </button>
            <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0B1F3A] rounded hover:bg-[#15325C] transition-colors">
              <Tag className="w-4 h-4" />
              Topic Article
            </button>
            <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0B1F3A] rounded hover:bg-[#15325C] transition-colors">
              <BookOpen className="w-4 h-4" />
              Daily Brief
            </button>
          </div>
        </header>

        {/* Dashboard Content */}
        <main className="flex-1 overflow-y-auto p-8 flex gap-12">
          {/* Left Column: Top Stories */}
          <div className="flex-1 max-w-[65%] flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-[#F0F0F0] pb-2">
              <h2 className="text-sm font-semibold tracking-widest text-[#6B7280] uppercase">
                Top Strategic Signals
              </h2>
              <button className="text-sm text-[#0B1F3A] font-medium flex items-center gap-1 hover:text-[#C09A3A] transition-colors">
                View All <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col">
              {TOP_STORIES.map((story) => (
                <div key={story.id} className="group flex gap-6 py-8 border-b border-[#F0F0F0] last:border-0 hover:bg-gray-50/50 transition-colors -mx-4 px-4 rounded-lg">
                  {/* Rank Number */}
                  <div className="flex-shrink-0 w-12 pt-1 text-3xl font-light text-[#E5E7EB] font-['Playfair_Display']">
                    {story.id}
                  </div>

                  {/* Content */}
                  <div className="flex-1 flex flex-col gap-3">
                    <div className="flex justify-between items-start gap-4">
                      <h3 className="font-['Playfair_Display'] text-2xl font-bold leading-tight text-[#1A1A2E] group-hover:text-[#0B1F3A] transition-colors">
                        {story.headline}
                      </h3>
                      {/* Score Badge */}
                      <div className="flex-shrink-0 bg-[#C09A3A] px-3 py-1 rounded flex items-center gap-1">
                        <span className="text-sm font-bold text-[#1A1A2E]">{story.score}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-sm text-[#6B7280]">
                      <span className="font-medium text-[#1A1A2E] uppercase tracking-wider text-xs">{story.source}</span>
                      <span className="w-1 h-1 rounded-full bg-[#D1D5DB]"></span>
                      <span>{story.time}</span>
                    </div>

                    <p className="text-[#1A1A2E]/80 leading-relaxed text-base">
                      {story.summary}
                    </p>

                    <div className="flex items-center justify-between mt-2">
                      <div className="flex gap-2">
                        {story.tags.map((tag) => (
                          <span key={tag} className="px-2.5 py-1 text-xs font-medium border border-[#E5E7EB] text-[#6B7280] rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <button className="text-sm font-medium text-[#0B1F3A] hover:text-[#C09A3A] transition-colors flex items-center gap-1">
                        RGI Analysis <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: What Matters Today */}
          <div className="w-[35%] min-w-[320px] flex flex-col gap-6">
            <div className="border-l-2 border-[#C09A3A] pl-6 h-full flex flex-col gap-6">
              <div className="flex items-center justify-between border-b border-[#F0F0F0] pb-2">
                <h2 className="text-sm font-semibold tracking-widest text-[#6B7280] uppercase">
                  What Matters Today
                </h2>
              </div>

              <div className="flex flex-col gap-4">
                <p className="text-sm text-[#6B7280] leading-relaxed mb-2">
                  Key geopolitical and economic themes clustering across high-reliability sources over the past 24 hours.
                </p>

                {WHAT_MATTERS.map((topic) => (
                  <div key={topic.rank} className="flex items-center justify-between group p-3 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-[#F0F0F0]">
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-bold text-[#C09A3A] w-4">
                        {topic.rank}.
                      </span>
                      <div className="flex flex-col">
                        <span className="font-medium text-[#1A1A2E] text-sm">
                          {topic.topic}
                        </span>
                        <span className="text-xs text-[#6B7280]">
                          {topic.sources} sources
                        </span>
                      </div>
                    </div>
                    <div className="bg-gray-100 px-2 py-1 rounded text-xs font-bold text-[#1A1A2E]">
                      {topic.score}
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Box */}
              <div className="mt-8 bg-[#0B1F3A] p-6 rounded-lg text-white">
                <h3 className="font-['Playfair_Display'] text-xl font-bold mb-2">
                  Generate Strategic Brief
                </h3>
                <p className="text-sm text-white/70 mb-6 leading-relaxed">
                  Our AI has processed 142 articles and identified 3 primary strategic narratives for today.
                </p>
                <button className="w-full bg-[#C09A3A] text-[#1A1A2E] font-medium py-2.5 rounded hover:bg-[#D4AF4E] transition-colors flex items-center justify-center gap-2">
                  <PenTool className="w-4 h-4" />
                  Generate Brief
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default Dashboard;
