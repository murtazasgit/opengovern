import React from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AppWalletProvider } from './utils/WalletContext'
import { ConnectWallet } from './components/ConnectWallet'
import Home from './Home'
import DAOPage from './pages/DAOPage'
import ExplorePage from './pages/ExplorePage'
import EditorialPage from './pages/EditorialPage'
import AboutPage from './pages/AboutPage'

const NavLink = ({ to, text }: { to: string; text: string }) => {
  const location = useLocation()
  const isActive = location.pathname === to

  return (
    <Link to={to} className="relative group block mb-6">
      <div
        className={`panel-web3 p-4 uppercase font-bold text-sm tracking-widest text-center transition-all duration-300 ${isActive ? 'bg-[#fbbf24] lg:translate-x-4 shadow-none translate-x-1 translate-y-1' : 'hover:translate-x-2'}`}
      >
        {text}
      </div>
      {/* Decorative node connector line for desktop */}
      <div className="absolute top-1/2 -right-12 w-12 h-1 bg-black -z-10 hidden lg:block opacity-50"></div>
      <div className="absolute top-1/2 -right-12 w-3 h-3 rounded-full bg-black -mt-1 hidden lg:block shadow-[2px_2px_0_#000]"></div>
    </Link>
  )
}

function Layout() {
  return (
    <div className="min-h-screen text-black flex flex-col lg:flex-row relative z-10 p-4 lg:p-8 xl:p-12 overflow-hidden gap-8">
      <Toaster position="bottom-right" toastOptions={{ className: 'border-2 border-black font-mono shadow-[4px_4px_0_#000]' }} />

      {/* ── Side Navigation ──────────────────────────────────────────── */}
      <nav className="w-full lg:w-[280px] flex-shrink-0 flex flex-col z-20 sticky top-4 lg:h-[calc(100vh-64px)]">
        {/* Main Logo Block */}
        <div className="panel-web3 p-8 bg-white flex flex-col items-center justify-center mb-12 transform -rotate-1">
          <h1 className="text-4xl xl:text-5xl font-extrabold tracking-tighter text-center uppercase leading-none mb-2">OPEN</h1>
          <h1 className="text-4xl xl:text-5xl font-extrabold tracking-tighter text-center uppercase leading-none text-[#7c3aed]">GOVERN</h1>
        </div>

        {/* Navigation pills */}
        <div className="flex-1 hidden lg:flex flex-col justify-start pr-12 relative border-r-[4px] border-black">
          <NavLink to="/" text="Governance" />
          <NavLink to="/explore" text="Explore" />
          <NavLink to="/editorial" text="Editorial" />
          <NavLink to="/about" text="About" />
        </div>
      </nav>

      {/* ── Main Content Area ──────────────────────────────────────────── */}
      <main className="flex-1 w-full max-w-6xl mx-auto z-10 flex flex-col">
        {/* Top Bar inside main content for Wallet */}
        <header className="flex flex-col sm:flex-row justify-between items-center mb-12 gap-4">
          <div className="hidden sm:block text-2xl font-black uppercase tracking-widest bg-white border-2 border-black px-4 py-2 shadow-[4px_4px_0_#000] transform -rotate-1">
            Dashboard
          </div>
          <ConnectWallet />
        </header>

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/dao/:appId" element={<DAOPage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/editorial" element={<EditorialPage />} />
          <Route path="/about" element={<AboutPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AppWalletProvider>
      <BrowserRouter>
        <Layout />
      </BrowserRouter>
    </AppWalletProvider>
  )
}
