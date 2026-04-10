import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTheme } from '../context/ThemeContext';
import useDoctorAuthStore from '../store/doctorAuthStore';
import { Bell, Home, CalendarDays, ClipboardList, MessageSquare, Users, Video, UserRound, LogOut, Sun, Moon, Menu, X } from 'lucide-react';

const DoctorDashboardNavbar = () => {
    const { theme, toggleTheme } = useTheme();
    const { logout, isLoading } = useDoctorAuthStore();
    const [isOpen, setIsOpen] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const isDark = theme === 'dark';

    const navLinks = [
        { to: '/doctordashboard', label: 'Dashboard', icon: Home },
        { to: '/doctorschedule', label: 'Schedule', icon: CalendarDays },
        { to: '/doctorappointments', label: 'Appointments', icon: ClipboardList },
        { to: '/chat', label: 'Messages', icon: MessageSquare },
        { to: '/doctordirectory', label: 'Clients', icon: Users },
        { to: '/video-call', label: 'Video Call', icon: Video },
    ];

    const handleLogout = async () => {
        const result = await logout();
        if (result.success) {
            navigate('/');
        }
    };

    const linkBase = 'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors';

    return (
        <nav className={`fixed top-0 w-full z-50 border-b backdrop-blur-xl ${isDark ? 'bg-slate-900/95 border-slate-700 text-slate-100' : 'bg-white/95 border-slate-200 text-slate-900'}`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="h-18 min-h-[72px] flex items-center justify-between gap-4">
                    <Link to="/doctordashboard" className="flex items-center gap-2">
                        <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${isDark ? 'bg-blue-500/20' : 'bg-blue-50'}`}>
                            <UserRound className={`h-5 w-5 ${isDark ? 'text-blue-300' : 'text-blue-700'}`} />
                        </div>
                        <div className="leading-tight">
                            <div className="text-base font-semibold tracking-tight">MediConnect</div>
                            <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Doctor Portal</div>
                        </div>
                    </Link>

                    <div className="hidden xl:flex items-center gap-1">
                        {navLinks.map((item) => {
                            const isActive = location.pathname === item.to;
                            return (
                                <Link
                                    key={item.to}
                                    to={item.to}
                                    className={`${linkBase} ${isActive
                                        ? isDark
                                            ? 'bg-slate-800 text-slate-100'
                                            : 'bg-slate-100 text-slate-900'
                                        : isDark
                                            ? 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                        }`}
                                >
                                    <item.icon className="h-4 w-4" />
                                    {item.label}
                                </Link>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className={`p-2 rounded-lg border transition-colors ${isDark ? 'border-slate-600 hover:bg-slate-800 text-slate-200' : 'border-slate-200 hover:bg-slate-100 text-slate-700'}`}
                            aria-label="Notifications"
                        >
                            <Bell className="h-4 w-4" />
                        </button>

                        <button
                            type="button"
                            onClick={toggleTheme}
                            className={`p-2 rounded-lg border transition-colors ${isDark ? 'border-slate-600 hover:bg-slate-800 text-slate-200' : 'border-slate-200 hover:bg-slate-100 text-slate-700'}`}
                            aria-label="Toggle theme"
                        >
                            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                        </button>

                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => navigate('/doctorprofile')}
                            className={`hidden sm:inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${isDark ? 'border-slate-600 text-slate-200 hover:bg-slate-800 hover:text-slate-100' : 'border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900'}`}
                        >
                            <UserRound className="h-4 w-4" />
                            Profile
                        </motion.button>

                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleLogout}
                            disabled={isLoading}
                            className="hidden sm:inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
                        >
                            <LogOut className="h-4 w-4" />
                            Logout
                        </motion.button>

                        <button
                            type="button"
                            onClick={() => setIsOpen((v) => !v)}
                            className={`xl:hidden p-2 rounded-lg border transition-colors ${isDark ? 'border-slate-600 hover:bg-slate-800 text-slate-200' : 'border-slate-200 hover:bg-slate-100 text-slate-700'}`}
                            aria-label="Toggle menu"
                        >
                            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                        </button>
                    </div>
                </div>
            </div>

            {isOpen && (
                <div className={`xl:hidden border-t ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
                    <div className="px-4 py-3 space-y-1">
                        {navLinks.map((item) => {
                            const isActive = location.pathname === item.to;
                            return (
                                <Link
                                    key={item.to}
                                    to={item.to}
                                    onClick={() => setIsOpen(false)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive
                                        ? isDark
                                            ? 'bg-slate-800 text-slate-100'
                                            : 'bg-slate-100 text-slate-900'
                                        : isDark
                                            ? 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                        }`}
                                >
                                    <item.icon className="h-4 w-4" />
                                    {item.label}
                                </Link>
                            );
                        })}

                        <Link
                            to="/doctorprofile"
                            onClick={() => setIsOpen(false)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isDark ? 'text-slate-300 hover:bg-slate-800 hover:text-slate-100' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
                        >
                            <UserRound className="h-4 w-4" />
                            Profile
                        </Link>

                        <button
                            type="button"
                            onClick={handleLogout}
                            disabled={isLoading}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
                        >
                            <LogOut className="h-4 w-4" />
                            Logout
                        </button>
                    </div>
                </div>
            )}
        </nav>
    );
};

export default DoctorDashboardNavbar;
