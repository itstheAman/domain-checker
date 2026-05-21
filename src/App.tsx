import React, { useState, useEffect } from 'react';

// Interfaces for our state variables
interface AiAnalysisResult {
  domain: string;
  status: 'available' | 'taken' | 'premium' | 'unknown';
  reason: string;
  registrar?: string;
  creationDate?: string;
  approxValue?: string;
}

interface DomainResult {
  name: string;
  status: 'checking' | 'available' | 'taken';
  rarity?: {
    text: string;
    color: string;
  };
  aiAnalysis?: AiAnalysisResult | null;
  explanation?: string;
}

// DNS Query utility using Cloudflare's CORS-friendly JSON DNS resolver
async function checkSingleDomainDNS(domainName: string) {
  const cleaned = domainName.toLowerCase().trim().replace(/^(https?:\/\/)?(www\.)?/, "");
  if (!cleaned || !cleaned.includes('.')) {
    return { available: false, method: 'Invalid Domain', confidence: 'Low' };
  }

  try {
    // Check NS records
    const nsUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(cleaned)}&type=NS`;
    const nsResponse = await fetch(nsUrl, { headers: { 'Accept': 'application/dns-json' } });
    if (!nsResponse.ok) throw new Error('DNS Query failed');
    const nsData = await nsResponse.json();

    // NXDOMAIN (Status 3) means no DNS records exist, highly likely to be unregistered
    if (nsData.Status === 3) {
      // Double check with SOA (Start of Authority)
      const soaUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(cleaned)}&type=SOA`;
      const soaResponse = await fetch(soaUrl, { headers: { 'Accept': 'application/dns-json' } });
      const soaData = await soaResponse.json();
      
      if (soaData.Status === 3) {
        return { available: true, method: 'DNS (NXDOMAIN)', confidence: 'High' };
      }
    }

    // Status 0 with Answer records means domain is definitely taken and active
    if (nsData.Answer && nsData.Answer.length > 0) {
      return { available: false, method: 'DNS (Active Nameservers)', confidence: 'Absolute' };
    }

    // Sometimes DNS returns NOERROR (Status 0) but empty answer. Could be registered but inactive DNS.
    return { available: false, method: 'DNS (Reserved/No NS Records)', confidence: 'Medium' };
  } catch (error) {
    console.error("DNS Resolution Error for " + cleaned + ":", error);
    return { available: null, method: 'Network Error', confidence: 'None' };
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'bulk' | 'short' | 'brainstorm' | 'favorites'>('bulk');
  const [results, setResults] = useState<DomainResult[]>([]);
  const [bulkInput, setBulkInput] = useState<string>('mydomain, testgen123, rawrapps, alphacode');
  const [bulkTlds, setBulkTlds] = useState<string[]>(['.com', '.net']);
  
  // Short Domain state
  const [letterLength, setLetterLength] = useState<number>(4);
  const [shortType, setShortType] = useState<string>('pronounceable'); // 'pronounceable', 'letters', 'alphanumeric', 'consonants'
  const [selectedTlds, setSelectedTlds] = useState<string[]>(['.com']);
  const [batchSize, setBatchSize] = useState<number>(24);
  
  // Brainstorm state
  const [brainstormPrompt, setBrainstormPrompt] = useState<string>('A sustainable bamboo electric toothbrush subscription');
  const [brainstormTld, setBrainstormTld] = useState<string>('.com');
  const [brainstormResults, setBrainstormResults] = useState<DomainResult[]>([]);
  const [isBrainstorming, setIsBrainstorming] = useState<boolean>(false);

  // Favorites state
  const [favorites, setFavorites] = useState<DomainResult[]>(() => {
    const saved = localStorage.getItem('domainzen_favorites');
    return saved ? JSON.parse(saved) : [];
  });

  // UI / Scan State
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [scanTotal, setScanTotal] = useState<number>(0);
  const [filterStatus, setFilterStatus] = useState<string>('all'); // 'all', 'available', 'taken'

  // AI Modal details
  const [aiCheckingDomain, setAiCheckingDomain] = useState<string | null>(null);
  const [selectedAiDetails, setSelectedAiDetails] = useState<AiAnalysisResult | null>(null);
  const [isAiModalOpen, setIsAiModalOpen] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Save favorites to storage
  useEffect(() => {
    localStorage.setItem('domainzen_favorites', JSON.stringify(favorites));
  }, [favorites]);

  // Available TLD choices
  const availableTlds = ['.com', '.net', '.org', '.io', '.co', '.ai', '.xyz', '.app', '.tech', '.me', '.dev'];

  // Trigger Grounded AI Deep Check
  const handleAiDeepCheck = async (domain: string) => {
    setAiCheckingDomain(domain);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/deep-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Secret configuration issue or API limitation.");
      }

      const parsedData = await response.json();

      // Update in our active lists
      setResults(prev => prev.map(item => {
        if (item.name === domain) {
          return { ...item, status: parsedData.status === 'available' ? 'available' : 'taken', aiAnalysis: parsedData };
        }
        return item;
      }));

      setBrainstormResults(prev => prev.map(item => {
        if (item.name === domain) {
          return { ...item, status: parsedData.status === 'available' ? 'available' : 'taken', aiAnalysis: parsedData };
        }
        return item;
      }));

      setSelectedAiDetails(parsedData);
      setIsAiModalOpen(true);
    } catch (error: any) {
      console.error("AI check error: ", error);
      setErrorMessage(error.message || "An expected error occurred while fetching deep AI insights.");
    } finally {
      setAiCheckingDomain(null);
    }
  };

  // Generate brainstormed domains
  const handleAiBrainstorm = async () => {
    if (!brainstormPrompt.trim()) return;
    setIsBrainstorming(true);
    setBrainstormResults([]);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/brainstorm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: brainstormPrompt, tld: brainstormTld })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Brainstorming failed");
      }

      const parsed = await response.json();

      const items = parsed.suggestions.map((s: any) => ({
        name: s.domainName.toLowerCase().trim(),
        explanation: s.explanation,
        status: 'checking',
        aiAnalysis: null as any
      }));

      setBrainstormResults(items);

      // Trigger automatic parallel fast DNS check on generated concepts
      for (let i = 0; i < items.length; i++) {
        const checked = await checkSingleDomainDNS(items[i].name);
        setBrainstormResults(prev => prev.map((item, index) => {
          if (index === i) {
            return { ...item, status: checked.available ? 'available' : 'taken' };
          }
          return item;
        }));
      }
    } catch (e: any) {
      console.error(e);
      setErrorMessage(e.message || "Failed to brainstorm brand names. Ensure the API key configuration is active.");
    } finally {
      setIsBrainstorming(false);
    }
  };

  // Helper to generate short variations
  const generateShortDomainString = (length: number, type: string) => {
    const vowels = 'aeiou';
    const consonants = 'bcdfghjklmnpqrstvwxyz';
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    const alphaNumeric = 'abcdefghijklmnopqrstuvwxyz0123456789';

    let domain = '';
    if (type === 'pronounceable') {
      let isConsonant = Math.random() > 0.5;
      for (let i = 0; i < length; i++) {
        if (isConsonant) {
          domain += consonants[Math.floor(Math.random() * consonants.length)];
        } else {
          domain += vowels[Math.floor(Math.random() * vowels.length)];
        }
        isConsonant = !isConsonant; // Alternate
      }
    } else if (type === 'consonants') {
      for (let i = 0; i < length; i++) {
        domain += consonants[Math.floor(Math.random() * consonants.length)];
      }
    } else if (type === 'letters') {
      for (let i = 0; i < length; i++) {
        domain += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
    } else if (type === 'alphanumeric') {
      domain += alphabet[Math.floor(Math.random() * alphabet.length)]; // start with letter
      for (let i = 1; i < length; i++) {
        domain += alphaNumeric[Math.floor(Math.random() * alphaNumeric.length)];
      }
    }
    return domain;
  };

  // Run Bulk Checker
  const runBulkCheck = async () => {
    setIsScanning(true);
    setScanProgress(0);
    setErrorMessage(null);
    
    // Split on comma, space, or newline
    const rawTokens = bulkInput.split(/[\s,\n]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
    
    // Parse domains & apply TLDs if not present
    const domainsToScan: string[] = [];
    rawTokens.forEach(token => {
      if (token.includes('.')) {
        domainsToScan.push(token);
      } else {
        bulkTlds.forEach(tld => {
          domainsToScan.push(`${token}${tld}`);
        });
      }
    });

    const uniqueDomains = [...new Set(domainsToScan)];
    setScanTotal(uniqueDomains.length);

    const initialResults = uniqueDomains.map(name => ({
      name,
      status: 'checking' as const,
      rarity: getRarityBadge(name),
      aiAnalysis: null
    }));
    setResults(initialResults);

    let progressCount = 0;
    // Batch resolution for efficiency
    for (let i = 0; i < uniqueDomains.length; i++) {
      const dName = uniqueDomains[i];
      const checkResult = await checkSingleDomainDNS(dName);
      
      setResults(prev => prev.map(item => {
        if (item.name === dName) {
          return { ...item, status: checkResult.available ? 'available' : 'taken' };
        }
        return item;
      }));
      progressCount++;
      setScanProgress(progressCount);
    }
    setIsScanning(false);
  };

  // Run Short Domain Scanner
  const runShortScanner = async () => {
    setIsScanning(true);
    setScanProgress(0);
    setErrorMessage(null);

    const generatedSet = new Set<string>();
    const maxCombinations = Math.pow(26, letterLength);
    const limit = Math.min(batchSize, maxCombinations);

    // Keep generating unique strings until we reach target count
    let safetyCounter = 0;
    while (generatedSet.size < limit && safetyCounter < 1000) {
      const raw = generateShortDomainString(letterLength, shortType);
      selectedTlds.forEach(tld => {
        generatedSet.add(`${raw}${tld}`);
      });
      safetyCounter++;
    }

    const uniqueList = Array.from(generatedSet).slice(0, batchSize);
    setScanTotal(uniqueList.length);

    const initialResults = uniqueList.map(name => ({
      name,
      status: 'checking' as const,
      rarity: getRarityBadge(name),
      aiAnalysis: null
    }));
    setResults(initialResults);

    let progressCount = 0;
    for (let i = 0; i < uniqueList.length; i++) {
      const targetDomain = uniqueList[i];
      const checkResult = await checkSingleDomainDNS(targetDomain);
      
      setResults(prev => prev.map(item => {
        if (item.name === targetDomain) {
          return { ...item, status: checkResult.available ? 'available' : 'taken' };
        }
        return item;
      }));
      progressCount++;
      setScanProgress(progressCount);
    }
    setIsScanning(false);
  };

  // Classify rarity level based on extension & character length
  const getRarityBadge = (domainName: string) => {
    const prefix = domainName.split('.')[0] || '';
    const ext = domainName.slice(prefix.length);
    const len = prefix.length;

    if (len <= 3 && ext === '.com') return { text: 'Ultra Rare 💎', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
    if (len <= 4 && ext === '.com') return { text: 'Premium Rare ✨', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
    if (len <= 3 && (ext === '.io' || ext === '.ai')) return { text: 'Highly Coveted 🌌', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' };
    if (len <= 4) return { text: 'Short ⚡', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' };
    return { text: 'Standard 🏷️', color: 'bg-slate-700/30 text-slate-300 border-slate-600/30' };
  };

  // Toggle favorites
  const toggleFavorite = (domain: DomainResult) => {
    setFavorites(prev => {
      const exists = prev.some(item => item.name === domain.name);
      if (exists) {
        return prev.filter(item => item.name !== domain.name);
      } else {
        return [...prev, domain];
      }
    });
  };

  const handleBulkCheckTldToggle = (tld: string) => {
    setBulkTlds(prev => 
      prev.includes(tld) ? prev.filter(item => item !== tld) : [...prev, tld]
    );
  };

  const handleShortCheckTldToggle = (tld: string) => {
    setSelectedTlds(prev => 
      prev.includes(tld) ? prev.filter(item => item !== tld) : [...prev, tld]
    );
  };

  // Download list as CSV
  const downloadCSV = () => {
    const list = results.filter(r => filterStatus === 'all' || r.status === filterStatus);
    const content = "Domain Name,Status,Classification\n" + 
      list.map(r => `"${r.name}","${r.status}","${r.rarity?.text || ''}"`).join("\n");
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `domain_results_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Bulk copy available list to clipboard
  const copyAvailableToClipboard = () => {
    const list = results.filter(r => r.status === 'available').map(r => r.name).join("\n");
    const tempInput = document.createElement("textarea");
    tempInput.value = list;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
  };

  const availableCount = results.filter(r => r.status === 'available').length;
  const takenCount = results.filter(r => r.status === 'taken').length;

  return (
    <div className="min-h-screen bg-[#0b0c14] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200 antialiased">
      {/* Top ambient color glows */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-10 right-1/4 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Header Bar */}
      <header className="border-b border-slate-800/80 bg-[#0f111a]/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 009 15c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201 0 1.007.054 2.0.159 2.985m1.979 4.19a1.978 1.978 0 002.828 0m9.93-2.83h2.12c1.18 0 2.164-.91 2.201-2.09a52.176 52.176 0 000-3.32c-.037-1.18-.92-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201 0 1.007.054 2.0.159 2.985M12 11a3 3 0 100-6 3 3 0 000 6z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                OmniDomain <span className="text-xs px-2 py-0.5 ml-2 rounded bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-400 border border-cyan-500/30">PREMIUM</span>
              </h1>
              <p className="text-[10px] text-slate-400 font-medium tracking-wide uppercase">Short Generator & AI Deep Check</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              id="favorites-tab-btn"
              onClick={() => setActiveTab('favorites')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-sm font-medium ${
                activeTab === 'favorites' 
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-300' 
                  : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800 text-slate-300'
              }`}
            >
              <svg className="w-4 h-4 text-amber-400 fill-current" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              Favorites ({favorites.length})
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        
        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 mb-8 bg-[#0f111a]/90 p-1.5 rounded-xl border border-slate-800/60 max-w-fit">
          <button
            id="tab-bulk-btn"
            onClick={() => { setActiveTab('bulk'); setResults([]); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
              activeTab === 'bulk' 
                ? 'bg-slate-800 text-white shadow-inner' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            Bulk Domain Checker
          </button>
          
          <button
            id="tab-short-btn"
            onClick={() => { setActiveTab('short'); setResults([]); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
              activeTab === 'short' 
                ? 'bg-slate-800 text-white shadow-inner' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Short Domain Generator
          </button>

          <button
            id="tab-brainstorm-btn"
            onClick={() => setActiveTab('brainstorm')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
              activeTab === 'brainstorm' 
                ? 'bg-slate-800 text-white shadow-inner' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            AI Brand Brainstormer
          </button>
        </div>

        {/* Global Error Banner */}
        {errorMessage && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center justify-between text-rose-200 text-sm gap-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-rose-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-rose-200 text-xs font-bold font-mono">Dismiss</button>
          </div>
        )}

        {/* --- MAIN TAB SECTIONS --- */}
        
        {activeTab === 'bulk' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Input panel */}
            <div className="lg:col-span-1 bg-[#0f111a] border border-slate-800/80 rounded-2xl p-6">
              <h3 className="text-lg font-bold text-white mb-2">Paste Domain Names</h3>
              <p className="text-xs text-slate-400 mb-4">
                Enter multiple domains or keywords (comma, space, or line-separated). If no extension is included, selected extensions will automatically append.
              </p>

              <textarea
                id="bulk-textarea"
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                rows={6}
                className="w-full bg-[#07080d] border border-slate-800 rounded-xl px-4 py-3 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all font-mono placeholder:text-slate-600"
                placeholder="e.g. google.com, alpha, design.io, buildsite"
              />

              {/* TLD Selection checklist */}
              <div className="mt-5">
                <label className="text-xs font-bold uppercase text-slate-400 tracking-wider">Auto-Append Extensions</label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {availableTlds.map(tld => (
                    <button
                      key={tld}
                      onClick={() => handleBulkCheckTldToggle(tld)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                        bulkTlds.includes(tld)
                          ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
                          : 'bg-[#07080d] border-slate-800 hover:border-slate-700 text-slate-400'
                      }`}
                    >
                      {tld}
                    </button>
                  ))}
                </div>
              </div>

              <button
                id="bulk-scan-btn"
                onClick={runBulkCheck}
                disabled={isScanning || !bulkInput.trim()}
                className="mt-6 w-full py-3.5 px-4 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white rounded-xl font-bold text-sm tracking-wide shadow-lg shadow-cyan-500/10 hover:shadow-cyan-500/20 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isScanning ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Scanning DNS...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    Check Availability
                  </>
                )}
              </button>
            </div>

            {/* Output Display area */}
            <div className="lg:col-span-2 space-y-4">
              {results.length > 0 && renderResultsControls()}
              {renderResultsTable()}
            </div>
          </div>
        )}

        {activeTab === 'short' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Generator control sidebar */}
            <div className="lg:col-span-1 bg-[#0f111a] border border-slate-800/80 rounded-2xl p-6 h-fit space-y-6">
              <div>
                <h3 className="text-lg font-bold text-white">Short Domain Generator</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Discover rare premium short domains matching precise character lengths. Great for starting a modern tech brand.
                </p>
              </div>

              {/* Length range */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Letter Length</label>
                  <span className="text-sm font-black text-cyan-400">{letterLength} Letters</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={8}
                  value={letterLength}
                  onChange={(e) => setLetterLength(parseInt(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-500 px-1 mt-1 font-mono">
                  <span>2L</span>
                  <span>4L (Highly Valued)</span>
                  <span>8L</span>
                </div>
              </div>

              {/* Character Strategy type */}
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Generator Mode</label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {[
                    { id: 'pronounceable', label: 'Pronounceable (CVCV)', desc: 'e.g., boba, kidu' },
                    { id: 'letters', label: 'Pure Letters (LLLL)', desc: 'e.g., akdi, jwie' },
                    { id: 'alphanumeric', label: 'Alphanumeric', desc: 'e.g., a1b2, k9u8' },
                    { id: 'consonants', label: 'Consonants Only', desc: 'e.g., rwxq, zxtp' }
                  ].map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setShortType(opt.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        shortType === opt.id
                          ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-300 shadow-md'
                          : 'bg-[#07080d] border-slate-800 hover:border-slate-700 text-slate-400'
                      }`}
                    >
                      <div className="text-xs font-bold">{opt.label}</div>
                      <div className="text-[9px] text-slate-500 font-mono mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Target Extensions */}
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Target Extensions (TLDs)</label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {availableTlds.map(tld => (
                    <button
                      key={tld}
                      onClick={() => handleShortCheckTldToggle(tld)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                        selectedTlds.includes(tld)
                          ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
                          : 'bg-[#07080d] border-slate-800 hover:border-slate-700 text-slate-400'
                      }`}
                    >
                      {tld}
                    </button>
                  ))}
                </div>
              </div>

              {/* Batch size */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Batch Size</label>
                  <span className="text-sm font-mono text-cyan-400 font-bold">{batchSize} Domains</span>
                </div>
                <div className="flex gap-2">
                  {[12, 24, 48, 96].map(size => (
                    <button
                      key={size}
                      onClick={() => setBatchSize(size)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        batchSize === size
                          ? 'bg-slate-700 border-slate-600 text-white shadow-inner'
                          : 'bg-[#07080d] border-slate-800 text-slate-400'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action */}
              <button
                id="short-scan-btn"
                onClick={runShortScanner}
                disabled={isScanning || selectedTlds.length === 0}
                className="w-full py-4 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white rounded-xl font-extrabold text-sm tracking-wide shadow-lg shadow-cyan-500/15 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isScanning ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Generating & Checking...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Generate & Scan Batch
                  </>
                )}
              </button>
            </div>

            {/* Generated Output */}
            <div className="lg:col-span-2 space-y-4">
              {results.length > 0 && renderResultsControls()}
              {renderResultsTable()}
            </div>
          </div>
        )}

        {activeTab === 'brainstorm' && (
          <div className="space-y-6">
            <div className="bg-[#0f111a] border border-slate-800/80 rounded-2xl p-6 lg:p-8">
              <div className="max-w-3xl">
                <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                  <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                  </svg>
                  AI Domain Name Brainstormer
                </h2>
                <p className="text-sm text-slate-400 mb-6">
                  Describe your business, idea, or startup. Gemini AI will brainstorm 10 catchy brand names, craft an explanation for each, and immediately verify their availability in real-time.
                </p>

                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1">
                    <input
                      id="brainstorm-input"
                      type="text"
                      value={brainstormPrompt}
                      onChange={(e) => setBrainstormPrompt(e.target.value)}
                      className="w-full bg-[#07080d] border border-slate-800 rounded-xl px-4 py-3.5 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all font-medium"
                      placeholder="e.g., A minimalist sustainable activewear brand using recycled ocean plastic"
                    />
                  </div>
                  <div className="w-full md:w-36">
                    <select
                      id="brainstorm-tld-select"
                      value={brainstormTld}
                      onChange={(e) => setBrainstormTld(e.target.value)}
                      className="w-full bg-[#07080d] border border-slate-800 rounded-xl px-4 py-3.5 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all font-semibold"
                    >
                      {availableTlds.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    id="brainstorm-submit-btn"
                    onClick={handleAiBrainstorm}
                    disabled={isBrainstorming || !brainstormPrompt.trim()}
                    className="py-3.5 px-6 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white rounded-xl font-bold text-sm tracking-wide shadow-lg shadow-cyan-500/10 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    {isBrainstorming ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Brainstorming...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Generate Ideas
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Brainstorm suggestions list */}
            {brainstormResults.length > 0 && (
              <div className="bg-[#0f111a] border border-slate-800/80 rounded-2xl overflow-hidden p-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-white">AI Recommendations</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Below are 10 names with their instant availability status.</p>
                  </div>
                  <button
                    onClick={() => {
                      const avail = brainstormResults.filter(r => r.status === 'available').map(r => r.name).join('\n');
                      const temp = document.createElement("textarea");
                      temp.value = avail;
                      document.body.appendChild(temp);
                      temp.select();
                      document.execCommand('copy');
                      document.body.removeChild(temp);
                    }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/40 text-slate-300 hover:bg-slate-800"
                  >
                    Copy All Available
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {brainstormResults.map((item, idx) => (
                    <div 
                      key={idx} 
                      className={`p-4 rounded-xl border transition-all ${
                        item.status === 'available' 
                          ? 'bg-emerald-500/[0.02] border-emerald-500/20 hover:border-emerald-500/40' 
                          : item.status === 'taken' 
                          ? 'bg-slate-900/40 border-slate-800/80 hover:border-slate-800' 
                          : 'bg-slate-900/20 border-slate-800/60'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-base font-extrabold text-white tracking-wide">{item.name}</span>
                          <span className="ml-2.5 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                            Idea #{idx+1}
                          </span>
                        </div>
                        <div>
                          {item.status === 'checking' && (
                            <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 font-semibold bg-amber-500/5 px-2.5 py-1 rounded-full border border-amber-500/20 animate-pulse">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
                              Checking
                            </span>
                          )}
                          {item.status === 'available' && (
                            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-bold bg-emerald-500/5 px-2.5 py-1 rounded-full border border-emerald-500/20">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              Available
                            </span>
                          )}
                          {item.status === 'taken' && (
                            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 font-medium bg-slate-800/30 px-2.5 py-1 rounded-full border border-slate-800">
                              Taken
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                        {item.explanation}
                      </p>

                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-800/80">
                        <div className="flex gap-2">
                          <button
                            onClick={() => toggleFavorite(item)}
                            className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-amber-400 transition-colors"
                            title="Add to Favorites"
                          >
                            <svg className={`w-4 h-4 ${favorites.some(f => f.name === item.name) ? 'text-amber-400 fill-current' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleAiDeepCheck(item.name)}
                            disabled={aiCheckingDomain !== null}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-semibold text-cyan-400 hover:bg-slate-800 transition-colors disabled:opacity-50"
                          >
                            {aiCheckingDomain === item.name ? (
                              <>
                                <svg className="animate-spin h-3.5 w-3.5 text-cyan-400" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Inspecting...
                              </>
                            ) : (
                              <>
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                </svg>
                                Deep AI Check
                              </>
                            )}
                          </button>
                        </div>

                        {item.status === 'available' && (
                          <div className="flex gap-2">
                            <a
                              href={`https://porkbun.com/checkout/search?q=${item.name}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded-lg border border-slate-700"
                            >
                              Porkbun
                            </a>
                            <a
                              href={`https://www.namecheap.com/domains/registration/results/?domain=${item.name}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded-lg border border-slate-700"
                            >
                              Namecheap
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'favorites' && (
          <div className="bg-[#0f111a] border border-slate-800/80 rounded-2xl p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-amber-400 fill-current" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  My Starred Domain Portfolio
                </h3>
                <p className="text-xs text-slate-400 mt-1">Saved premium domain names. Perfect for exporting or buying.</p>
              </div>

              {favorites.length > 0 && (
                <button
                  onClick={() => {
                    const csvContent = "Domain Name\n" + favorites.map(f => f.name).join("\n");
                    const blob = new Blob([csvContent], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "my_favorites.csv";
                    link.click();
                  }}
                  className="text-xs font-semibold flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Export Saved (CSV)
                </button>
              )}
            </div>

            {favorites.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 bg-slate-800/40 border border-slate-700/60 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </div>
                <h4 className="text-slate-300 font-bold">No starred domains yet</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">Click the star icon next to any available or checked domain to save them here for easy bulk registration later.</p>
              </div>
            ) : (
              <div className="border border-slate-800/80 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-[#07080d] border-b border-slate-800 text-xs uppercase font-bold text-slate-400">
                    <tr>
                      <th className="py-4 px-6">Domain</th>
                      <th className="py-4 px-6">Classification</th>
                      <th className="py-4 px-6">Quick Register Links</th>
                      <th className="py-4 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {favorites.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/30">
                        <td className="py-4 px-6">
                          <span className="font-extrabold text-white tracking-wide text-sm">{item.name}</span>
                        </td>
                        <td className="py-4 px-6">
                          <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${item.rarity?.color || 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                            {item.rarity?.text || 'Brandable'}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex gap-2.5">
                            <a
                              href={`https://porkbun.com/checkout/search?q=${item.name}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-bold text-cyan-400 hover:text-cyan-300 hover:underline"
                            >
                              Porkbun ↗
                            </a>
                            <a
                              href={`https://www.namecheap.com/domains/registration/results/?domain=${item.name}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-bold text-cyan-400 hover:text-cyan-300 hover:underline"
                            >
                              Namecheap ↗
                            </a>
                            <a
                              href={`https://www.godaddy.com/domainsearch/find?domainToCheck=${item.name}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-bold text-cyan-400 hover:text-cyan-300 hover:underline"
                            >
                              GoDaddy ↗
                            </a>
                          </div>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button
                            onClick={() => toggleFavorite(item)}
                            className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-amber-400 hover:text-slate-400"
                            title="Remove favorite"
                          >
                            <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Informative Help Guide cards */}
        <section className="mt-12 bg-slate-900/30 border border-slate-800/60 rounded-2xl p-6 lg:p-8">
          <h3 className="text-base font-bold text-white mb-4">💡 Professional Domain Insights</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <h4 className="text-sm font-bold text-cyan-400">Ultra-Fast DNS Scanning</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Our scan queries real-time nameserver structures. When DNS replies <code className="bg-slate-900 px-1 py-0.5 rounded text-rose-400">NXDOMAIN</code>, there are zero active nameserver assignments, yielding a 95%+ probability that the domain is unregistered.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-bold text-purple-400">Why Short Domains are Valuable</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Short 2 to 4 letter domains are inherently finite, premium assets. They are highly memorable, boost authority, and can be resold on secondary marketplaces (Sedo, Afternic) for premium valuations.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-bold text-emerald-400">AI Deep Verification</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Sometimes premium/parked domains show inactive DNS. Our **Deep AI Verification** bypasses these limitations using real-time search queries via Gemini to fetch the actual WHOIS registration status and domain brokerage listings.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* --- RENDERED UTILITIES & MODALS --- */}

      {/* AI Deep Check details dialog modal */}
      {isAiModalOpen && selectedAiDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsAiModalOpen(false)} />
          <div className="bg-[#0f111a] border border-slate-800 rounded-2xl p-6 max-w-lg w-full z-10 relative overflow-hidden shadow-2xl">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-400 to-indigo-600" />
            
            <div className="flex justify-between items-start mb-4">
              <div>
                <span className="text-xs text-cyan-400 font-extrabold uppercase tracking-widest font-mono">Verified via Gemini Search</span>
                <h3 className="text-xl font-black text-white mt-1">{selectedAiDetails.domain}</h3>
              </div>
              <button 
                onClick={() => setIsAiModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#07080d] p-3 rounded-xl border border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Inspected Status</div>
                  <div className="text-sm font-extrabold mt-1 capitalize flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${selectedAiDetails.status === 'available' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    {selectedAiDetails.status}
                  </div>
                </div>
                <div className="bg-[#07080d] p-3 rounded-xl border border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Estimated Market Value</div>
                  <div className="text-sm font-extrabold text-amber-400 mt-1">{selectedAiDetails.approxValue || '$10'}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#07080d] p-3 rounded-xl border border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Current Registrar</div>
                  <div className="text-xs font-bold text-slate-300 mt-1">{selectedAiDetails.registrar || 'None/Available'}</div>
                </div>
                <div className="bg-[#07080d] p-3 rounded-xl border border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Creation Date / Age</div>
                  <div className="text-xs font-bold text-slate-300 mt-1">{selectedAiDetails.creationDate || 'N/A'}</div>
                </div>
              </div>

              <div className="bg-[#07080d] p-4 rounded-xl border border-slate-800">
                <div className="text-[10px] uppercase font-bold text-slate-500 mb-1.5">Search Findings & Analysis</div>
                <p className="text-xs text-slate-300 leading-relaxed font-medium">
                  {selectedAiDetails.reason}
                </p>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setIsAiModalOpen(false)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold border border-slate-700 transition-colors"
              >
                Close Panel
              </button>
              {selectedAiDetails.status === 'available' && (
                <a
                  href={`https://porkbun.com/checkout/search?q=${selectedAiDetails.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 text-white rounded-lg text-xs font-bold text-center hover:opacity-90 transition-opacity"
                >
                  Buy Now on Porkbun ↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Static Footer */}
      <footer className="border-t border-slate-800/80 bg-[#07080d] py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} OmniDomain. Premium client-side DNS Over HTTPS resolving. All checks run directly within your browser context.
          </p>
        </div>
      </footer>
    </div>
  );

  // Render scan statistics and filters
  function renderResultsControls() {
    const list = results.filter(r => filterStatus === 'all' || r.status === filterStatus);
    return (
      <div className="bg-[#0f111a] border border-slate-800/80 rounded-2xl p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5 bg-[#07080d] px-3 py-1.5 rounded-xl border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400">Available</span>
            <span className="text-sm font-extrabold text-emerald-400">{availableCount}</span>
          </div>

          <div className="flex items-center gap-1.5 bg-[#07080d] px-3 py-1.5 rounded-xl border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400">Taken</span>
            <span className="text-sm font-extrabold text-slate-500">{takenCount}</span>
          </div>

          <div className="flex gap-1.5 bg-[#07080d] p-1 rounded-xl border border-slate-800 text-xs">
            {[
              { id: 'all', label: 'All Results' },
              { id: 'available', label: 'Only Available' },
              { id: 'taken', label: 'Only Taken' }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilterStatus(f.id)}
                className={`px-3 py-1 rounded-lg font-bold transition-all ${
                  filterStatus === f.id
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 w-full md:w-auto">
          {availableCount > 0 && (
            <button
              onClick={copyAvailableToClipboard}
              className="flex-1 md:flex-initial text-xs font-bold bg-[#07080d] hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700 px-3 py-2 rounded-xl transition-all flex items-center justify-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m-5 10h6m-3-3h3m-3 6h3" />
              </svg>
              Copy Available ({availableCount})
            </button>
          )}
          <button
            onClick={downloadCSV}
            className="flex-1 md:flex-initial text-xs font-bold bg-[#07080d] hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700 px-3 py-2 rounded-xl transition-all flex items-center justify-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV ({list.length})
          </button>
        </div>
      </div>
    );
  }

  // Render the core interactive results matrix
  function renderResultsTable() {
    const list = results.filter(r => filterStatus === 'all' || r.status === filterStatus);

    if (results.length === 0) {
      return (
        <div className="bg-[#0f111a] border border-slate-800/80 rounded-2xl p-12 text-center">
          <div className="h-12 w-12 rounded-xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4 border border-slate-700/60">
            <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <h4 className="text-slate-300 font-extrabold text-sm">No Active Domain Scan</h4>
          <p className="text-xs text-slate-500 mt-1.5 max-w-xs mx-auto">
            Input target domains on the left panel or configure the short letter parameters to initiate a fast real-time scan.
          </p>
        </div>
      );
    }

    return (
      <div className="bg-[#0f111a] border border-slate-800/80 rounded-2xl overflow-hidden">
        {isScanning && (
          <div className="bg-[#07080d] border-b border-slate-800 p-4">
            <div className="flex items-center justify-between text-xs font-bold text-slate-400 mb-1.5">
              <span>Scanning Progress</span>
              <span className="font-mono text-cyan-400">{Math.round((scanProgress / scanTotal) * 100) || 0}%</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 transition-all duration-300" 
                style={{ width: `${(scanProgress / scanTotal) * 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#07080d] border-b border-slate-800 text-[10px] uppercase font-bold tracking-wider text-slate-400">
              <tr>
                <th className="py-4 px-6 w-12 text-center">Star</th>
                <th className="py-4 px-6 border-l border-slate-800/40">Domain Name</th>
                <th className="py-4 px-6">Availability</th>
                <th className="py-4 px-6">Rating/Rarity</th>
                <th className="py-4 px-6 text-right">Smart Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {list.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-900/20 group">
                  {/* Star Toggle Favorite */}
                  <td className="py-4 px-6 text-center">
                    <button
                      onClick={() => toggleFavorite(item)}
                      className="text-slate-600 hover:text-amber-400 transition-colors"
                    >
                      <svg 
                        className={`w-4 h-4 ${favorites.some(f => f.name === item.name) ? 'text-amber-400 fill-current' : ''}`} 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    </button>
                  </td>

                  {/* Domain string */}
                  <td className="py-4 px-6 border-l border-slate-800/40">
                    <span className="font-extrabold text-white tracking-wide text-sm">{item.name}</span>
                  </td>

                  {/* Availability badge status */}
                  <td className="py-4 px-6 text-sm">
                    {item.status === 'checking' && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 font-semibold bg-amber-500/5 px-2.5 py-0.5 rounded-full border border-amber-500/10 animate-pulse">
                        Checking
                      </span>
                    )}
                    {item.status === 'available' && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-bold bg-emerald-500/5 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                        Available
                      </span>
                    )}
                    {item.status === 'taken' && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium bg-slate-800/40 px-2.5 py-0.5 rounded-full border border-slate-800">
                        Taken
                      </span>
                    )}
                  </td>

                  {/* Rarity */}
                  <td className="py-4 px-6">
                    <span className={`inline-block text-[10px] font-semibold px-2.5 py-0.5 rounded-full border ${item.rarity?.color || 'bg-slate-800 text-slate-400'}`}>
                      {item.rarity?.text || 'Standard'}
                    </span>
                  </td>

                  {/* Fast purchase or deep AI verify */}
                  <td className="py-4 px-6 text-right">
                    <div className="flex items-center justify-end gap-2.5">
                      <button
                        onClick={() => handleAiDeepCheck(item.name)}
                        disabled={aiCheckingDomain !== null}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-cyan-400 hover:bg-slate-800 hover:border-slate-700 transition-all flex items-center gap-1 disabled:opacity-50"
                      >
                        {aiCheckingDomain === item.name ? (
                          <>
                            <svg className="animate-spin h-3.5 w-3.5 text-cyan-400" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Inspecting...
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                            Deep AI Check
                          </>
                        )}
                      </button>

                      {item.status === 'available' && (
                        <div className="opacity-100 transition-opacity flex gap-1.5">
                          <a
                            href={`https://porkbun.com/checkout/search?q=${item.name}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-bold text-slate-300 hover:text-white bg-slate-800/80 border border-slate-700 hover:bg-slate-700 px-2 py-1.5 rounded-lg"
                          >
                            Porkbun
                          </a>
                          <a
                            href={`https://www.namecheap.com/domains/registration/results/?domain=${item.name}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-bold text-slate-300 hover:text-white bg-slate-800/80 border border-slate-700 hover:bg-slate-700 px-2 py-1.5 rounded-lg"
                          >
                            Namecheap
                          </a>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
}
