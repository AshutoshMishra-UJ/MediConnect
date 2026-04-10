import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '../context/ThemeContext';
import AuthModal from './AuthModal'; // Import the new modal component
import '../pages/theme.css';
import { Menu, X, Moon, Sun, Stethoscope } from 'lucide-react';

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const [isModalOpen, setIsModalOpen] = useState(false); // New state for the modal
  const isDark = theme === 'dark';

  const navLinks = [
    { href: '#home', label: 'Home' },
    { href: '#services', label: 'Services' },
    { href: '#about', label: 'About' },
    { href: '#contact', label: 'Contact' }
  ];

  return (
    <>
      <nav
        className={`fixed w-full z-50 border-b backdrop-blur-xl transition-colors duration-300 ${isDark ? 'bg-slate-900/90 border-slate-700 text-slate-100' : 'bg-white/90 border-slate-200 text-slate-900'
          }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-18 min-h-[72px]">
            <motion.a href="#home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2">
              <span className={`p-2 rounded-xl ${isDark ? 'bg-blue-500/20' : 'bg-blue-50'}`}>
                <Stethoscope className={`w-5 h-5 ${isDark ? 'text-blue-300' : 'text-blue-700'}`} />
              </span>
              <span className="text-xl font-semibold tracking-tight">MediConnect</span>
            </motion.a>

            <div className="hidden md:flex items-center gap-7">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className={`text-sm font-medium transition-colors ${isDark ? 'text-slate-300 hover:text-slate-100' : 'text-slate-700 hover:text-slate-900'
                    }`}
                >
                  {link.label}
                </a>
              ))}
            </div>

            <div className="flex items-center gap-2 md:gap-3">
              <button
                onClick={toggleTheme}
                className={`p-2 rounded-lg border transition ${isDark ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-100'
                  }`}
                aria-label="Toggle theme"
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>

              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="hidden sm:block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                onClick={() => setIsModalOpen(true)}
              >
                Book Appointment
              </motion.button>

              <button
                onClick={() => setIsOpen(!isOpen)}
                className={`md:hidden p-2 rounded-lg border ${isDark ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-100'
                  }`}
                aria-label="Open menu"
              >
                {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {isOpen && (
          <div className={`md:hidden border-t ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
            <div className="px-4 py-3 space-y-1">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${isDark ? 'text-slate-300 hover:text-slate-100 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                >
                  {link.label}
                </a>
              ))}

              <div className="pt-2">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    setIsModalOpen(true);
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  Book Appointment
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Auth Modal */}
      <AuthModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
};

export default Navbar;