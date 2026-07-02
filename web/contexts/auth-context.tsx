"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  UserInfo,
  LoginRequest,
  RegisterRequest,
  login as apiLogin,
  register as apiRegister,
  getCurrentUser,
  logout as apiLogout,
  getToken,
} from "@/lib/auth-api";

interface AuthContextType {
  user: UserInfo | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (request: LoginRequest) => Promise<UserInfo>;
  register: (request: RegisterRequest) => Promise<UserInfo>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const userInfo = await getCurrentUser();
      setUser(userInfo);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      const token = getToken();
      if (token) {
        await refreshUser();
      }
      setIsLoading(false);
    };
    initAuth();
  }, [refreshUser]);

  const login = async (request: LoginRequest) => {
    const response = await apiLogin(request);
    setUser(response.user);
    return response.user;
  };

  const register = async (request: RegisterRequest) => {
    const response = await apiRegister(request);
    setUser(response.user);
    return response.user;
  };

  const logout = () => {
    apiLogout();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
