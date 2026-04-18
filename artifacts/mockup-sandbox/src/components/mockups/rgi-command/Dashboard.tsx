import React from "react";
import { 
  BarChart3, 
  BookOpen, 
  Compass, 
  FileText, 
  Globe, 
  LayoutDashboard, 
  Settings, 
  Tag, 
  UploadCloud, 
  Users, 
  ArrowRight
} from "lucide-react";
import { cn } from "@/lib/utils";

// Sample Data
const topStories = [
  {
    id: 1,
    category: "Geopolitics",
    color: "bg-red-500",
    rank: "01",
    signal: "SIGNAL HIGH",
    tags: ["Iran", "Strait of Hormuz", "Energy"],
    score: "9.5 /10",
    headline: "Iran Conducts Unannounced Naval Drills Near Strait of Hormuz, Oil Markets React",
    excerpt: "The unannounced exercises involved swarming tactics by fast attack craft, temporarily disrupting commercial shipping lanes and causing a 2% spike in Brent crude.",
    source: "Reuters",
    timestamp: "2 hours ago",
  },
  {
    id: 2,
    category: "Finance",
    color: "bg-blue-500",
    rank: "02",
    signal: "SIGNAL ELEVATED",
    tags: ["Federal Reserve", "Interest Rates", "Bonds"],
    score: "8.7 /10",
    headline: "Fed Chair Powell Signals Rates Will Stay Higher for Longer Than Expected",
    excerpt: "Citing persistent inflation in the services sector, the Federal Reserve indicated that rate cuts are unlikely before Q4, sending bond yields to year-to-date highs.",
    source: "Bloomberg",
    timestamp: "4 hours ago",
  },
  {
    id: 3,
    category: "Supply Chain",
    color: "bg-emerald-500",
    rank: "03",
    signal: "SIGNAL MODERATE",
    tags: ["Semiconductors", "Taiwan", "Export Controls"],
    score: "7.2 /10",
    headline: "New US Export Restrictions Target Advanced Chip Manufacturing Equipment",
    excerpt: "The latest rules aim to close loopholes in previous restrictions, impacting major suppliers in Japan and the Netherlands alongside US firms.",
    source: "Financial Times",
    timestamp: "6 hours ago",
  }
];

const topics = [
  { rank: "01", dot: "bg-red-500", name: "Middle East Tensions", sources: "14 sources", score: "9.2" },
  { rank: "02", dot: "bg-blue-500", name: "Global Central Banks", sources: "8 sources", score: "8.5" },
  { rank: "03", dot: "bg-emerald-500", name: "Semiconductor Supply Chain", sources: "11 sources", score: "7.8" },
  { rank: "04", dot: "bg-amber-500", name: "European Energy Markets", sources: "6 sources", score: "6.4" },
  { rank: "05", dot: "bg-purple-500", name: "AI Regulation Frameworks", sources: "9 sources", score: "6.1" },
  { rank: "06", dot: "bg-cyan-500", name: "South China Sea Naval Activity", sources: "5 sources", score: "5.8" },
];

export function Dashboard() {
  return (
    <div className="flex h-screen w-full bg-[#F8F9FB] text-slate-900 font-sans selection:bg-blue-100">
      
      {/* Sidebar */}
      <aside className="w-64 bg-[#0D1B2A] text-slate-300 flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white font-bold tracking-tighter">
              RGI
            </div>
            <div>
              <h1 className="text-white font-semibold text-sm leading-tight">Rick Goings Institute</h1>
              <p className="text-xs text-slate-500">Strategic Intelligence</p>
            </div>
          </div>
        </div>

        <div className="p-4">
          <button className="w-full bg-[#2563EB] hover:bg-blue-600 text-white font-medium text-sm py-2 px-4 rounded transition-colors flex items-center justify-center gap-2">
            <FileText size={16} />
            Generate Brief
          </button>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          <ul className="space-y-1">
            <li>
              <a href="#" className="flex items-center gap-3 px-6 py-2.5 bg-[#1A2C42] text-white border-l-2 border-[#2563EB] text-sm font-medium">
                <LayoutDashboard size={18} className="text-[#2563EB]" />
                Dashboard
              </a>
            </li>
            <li>
              <a href="#" className="flex items-center gap-3 px-6 py-2.5 text-slate-400 hover:text-white hover:bg-[#152436] border-l-2 border-transparent transition-colors text-sm font-medium">
                <BookOpen size={18} />
                Daily Briefs
              </a>
            </li>
            <li>
              <a href="#" className="flex items-center gap-3 px-6 py-2.5 text-slate-400 hover:text-white hover:bg-[#152436] border-l-2 border-transparent transition-colors text-sm font-medium">
                <Globe size={18} />
                News Feed
              </a>
            </li>
            <li>
              <a href="#" className="flex items-center gap-3 px-6 py-2.5 text-slate-400 hover:text-white hover:bg-[#152436] border-l-2 border-transparent transition-colors text-sm font-medium">
                <BarChart3 size={18} />
                Topics & Signals
              </a>
            </li>
            <li>
              <a href="#" className="flex items-center gap-3 px-6 py-2.5 text-slate-400 hover:text-white hover:bg-[#152436] border-l-2 border-transparent transition-colors text-sm font-medium">
                <Users size={18} />
                Sources
              </a>
            </li>
          </ul>
        </nav>

        <div className="p-4 border-t border-slate-800">
          <a href="#" className="flex items-center gap-3 px-2 py-2 text-slate-400 hover:text-white transition-colors text-sm font-medium">
            <Settings size={18} />
            Settings
          </a>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        
        {/* Top Bar */}
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 flex-shrink-0 z-10 shadow-sm">
          <div className="flex items-center text-sm font-medium text-slate-800">
            <span className="text-slate-500">Intelligence Dashboard</span>
            <span className="mx-2 text-slate-300">/</span>
            <span>Today's Overview</span>
          </div>

          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors">
              <UploadCloud size={14} />
              Scrape Now
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-[#2563EB] rounded hover:bg-blue-600 transition-colors shadow-sm">
              <Tag size={14} />
              Topic Article
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-[#2563EB] rounded hover:bg-blue-600 transition-colors shadow-sm">
              <Globe size={14} />
              Daily Brief
            </button>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-6">
            
            {/* Left Column: Top Stories (62%) */}
            <div className="lg:w-[62%] flex flex-col gap-4">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Compass className="text-slate-400" size={18} />
                  <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Top Stories Today</h2>
                </div>
                <a href="#" className="text-[11px] font-bold uppercase tracking-widest text-[#2563EB] hover:text-blue-700 flex items-center gap-1">
                  Full Feed <ArrowRight size={12} />
                </a>
              </div>

              <div className="space-y-4">
                {topStories.map((story) => (
                  <div key={story.id} className="bg-white border border-slate-200 rounded shadow-sm relative overflow-hidden flex flex-col">
                    <div className={cn("absolute left-0 top-0 bottom-0 w-1", story.color)}></div>
                    
                    <div className="p-5 pl-6">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-700 tabular-nums">
                            {story.rank}
                          </div>
                          <span className="bg-[#D97706] text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm">
                            {story.signal}
                          </span>
                          <div className="flex gap-1.5">
                            {story.tags.map(tag => (
                              <span key={tag} className="bg-slate-100 text-slate-600 text-[10px] font-medium px-2 py-0.5 rounded-full border border-slate-200">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="bg-[#0D1B2A] text-white text-xs font-bold tabular-nums px-2.5 py-1 rounded shadow-sm">
                          {story.score}
                        </div>
                      </div>

                      <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">
                        {story.headline}
                      </h3>
                      
                      <p className="text-sm text-slate-600 mb-4 line-clamp-2 leading-relaxed">
                        {story.excerpt}
                      </p>

                      <div className="flex items-center justify-between mt-auto pt-4 border-t border-slate-100">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-medium text-slate-700">{story.source}</span>
                          <span>•</span>
                          <span>{story.timestamp}</span>
                        </div>
                        <button className="text-xs font-medium text-[#2563EB] hover:text-blue-700 flex items-center gap-1.5 transition-colors">
                          <Compass size={14} />
                          RGI Analysis
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: What Matters Today (38%) */}
            <div className="lg:w-[38%] flex flex-col gap-4">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <BarChart3 className="text-slate-400" size={18} />
                  <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">What Matters Today</h2>
                </div>
                <a href="#" className="text-[11px] font-bold uppercase tracking-widest text-[#2563EB] hover:text-blue-700 flex items-center gap-1">
                  All Topics <ArrowRight size={12} />
                </a>
              </div>

              <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
                <div className="p-0">
                  {topics.map((topic, i) => (
                    <div key={topic.rank} className={cn(
                      "flex items-center justify-between p-3.5 hover:bg-slate-50 transition-colors",
                      i !== topics.length - 1 && "border-b border-slate-100"
                    )}>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-400 tabular-nums w-4">
                          {topic.rank}
                        </span>
                        <div className={cn("w-2 h-2 rounded-full", topic.dot)}></div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800 leading-none mb-1">{topic.name}</p>
                          <p className="text-[11px] text-slate-500 leading-none">{topic.sources}</p>
                        </div>
                      </div>
                      <div className="text-sm font-bold text-slate-700 tabular-nums bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {topic.score}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-slate-50 p-3 border-t border-slate-200 flex justify-center">
                  <button className="text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors">
                    View full topic matrix
                  </button>
                </div>
              </div>

              <div className="mt-4 bg-[#0D1B2A] rounded p-5 text-white shadow-md relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500 opacity-10 rounded-full blur-2xl -mr-10 -mt-10"></div>
                <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                  System Status
                </h3>
                <div className="space-y-3 mt-4">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Articles Scraped (24h)</span>
                    <span className="font-bold tabular-nums">1,248</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">High Signal Alerts</span>
                    <span className="font-bold text-amber-400 tabular-nums">12</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Last Sync</span>
                    <span className="font-bold tabular-nums">4m ago</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
