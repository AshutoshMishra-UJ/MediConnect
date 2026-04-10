import express from 'express';
import { createOrder, verifyPayment, getDoctorPaymentHistory } from '../controllers/payment.controllers.js';
import { isAuthenticated } from '../middlewares/auth.middleware.js';
const router = express.Router();

// POST /api/payments/order
router.post('/order', isAuthenticated, createOrder);

// POST /api/payments/verify
router.post('/verify', isAuthenticated, verifyPayment);
router.get('/history', isAuthenticated, getDoctorPaymentHistory);

export default router;
