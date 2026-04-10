// In utils/axois.js (Note: It's usually spelled axios.js)

import axios from "axios";

export const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000",
  withCredentials: true, // This ensures cookies are sent with every request
  headers: {
    "Content-Type": "application/json",
  },
});

const isDoctorPath = (url = "") => url.includes('/doctor');
const isClientPath = (url = "") => url.includes('/client');

const decodeJwtPayload = (token = "") => {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
        .join("")
    );
    return JSON.parse(decoded);
  } catch {
    return null;
  }
};

const resolveAuthContext = (url = "", requestConfig = {}) => {
  const doctorToken = localStorage.getItem("doctorAccessToken");
  const clientToken = localStorage.getItem("clientAccessToken");

  if (isDoctorPath(url)) {
    return { type: "Doctor", accessToken: doctorToken };
  }

  if (isClientPath(url)) {
    return { type: "Client", accessToken: clientToken };
  }

  const authHeader = requestConfig?.headers?.Authorization || requestConfig?.headers?.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const payload = decodeJwtPayload(bearerToken);

  if (payload?.userType === "Doctor") {
    return { type: "Doctor", accessToken: doctorToken || bearerToken };
  }

  if (payload?.userType === "Client") {
    return { type: "Client", accessToken: clientToken || bearerToken };
  }

  if (doctorToken && !clientToken) {
    return { type: "Doctor", accessToken: doctorToken };
  }

  if (clientToken && !doctorToken) {
    return { type: "Client", accessToken: clientToken };
  }

  if (localStorage.getItem("doctorId") && !localStorage.getItem("clientId")) {
    return { type: "Doctor", accessToken: doctorToken };
  }

  return { type: "Client", accessToken: clientToken || doctorToken };
};

const getTokenForRequest = (url = "") => {
  return resolveAuthContext(url).accessToken;
};

// Add request interceptor to inject Authorization header
axiosInstance.interceptors.request.use(
  (config) => {
    const token = getTokenForRequest(config.url || '');

    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Add response interceptor to handle token expiration
axiosInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Never try to refresh while already calling refresh endpoint.
    if (originalRequest?.url?.includes('/refresh-token')) {
      return Promise.reject(error);
    }

    // If the error is due to token expiration (status 401) and we haven't already tried to refresh
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const requestUrl = originalRequest.url || '';
        const authCtx = resolveAuthContext(requestUrl, originalRequest);
        const isDoctor = authCtx.type === 'Doctor';
        const refreshPath = isDoctor ? '/doctor/refresh-token' : '/client/refresh-token';
        const refreshTokenKey = isDoctor ? 'doctorRefreshToken' : 'clientRefreshToken';
        const accessTokenKey = isDoctor ? 'doctorAccessToken' : 'clientAccessToken';
        const storedRefreshToken = localStorage.getItem(refreshTokenKey);

        // Try to refresh the token using the matching auth domain
        const refreshResponse = await axios.post(
          `${import.meta.env.VITE_API_URL || "http://localhost:5000"}${refreshPath}`,
          storedRefreshToken ? { refreshToken: storedRefreshToken } : {},
          { withCredentials: true }
        );

        const refreshed = refreshResponse?.data?.data || {};
        if (refreshed.accessToken) {
          localStorage.setItem(accessTokenKey, refreshed.accessToken);
        }
        if (refreshed.refreshToken) {
          localStorage.setItem(refreshTokenKey, refreshed.refreshToken);
        }

        // Ensure interceptor injects fresh auth token on retry.
        if (originalRequest.headers?.Authorization) {
          delete originalRequest.headers.Authorization;
        }
        if (originalRequest.headers?.authorization) {
          delete originalRequest.headers.authorization;
        }

        // If token refresh is successful, retry the original request
        return axiosInstance(originalRequest);
      } catch (refreshError) {
        // If token refresh fails, redirect to login or handle as needed
        console.error("Token refresh failed:", refreshError);

        // Clear local storage
        if (isDoctorPath(originalRequest.url || '')) {
          localStorage.removeItem("doctorId");
          localStorage.removeItem("doctorAccessToken");
          localStorage.removeItem("doctorRefreshToken");
        } else {
          localStorage.removeItem("clientId");
          localStorage.removeItem("clientAccessToken");
          localStorage.removeItem("clientRefreshToken");
        }

        // Redirect to login (if you have access to router)
        // window.location.href = "/login";

        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);