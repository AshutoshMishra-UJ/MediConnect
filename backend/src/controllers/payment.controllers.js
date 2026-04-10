import razorpay from '../utils/razorpay.js';
import Payment from '../models/payment.model.js';
import SlotRequest from '../models/slotRequest.model.js';
import Schedule from '../models/schedule.model.js';
import crypto from 'crypto';

export const createOrder = async (req, res) => {
  const { slotRequestId } = req.body;
  const currentClientId = req.client?._id?.toString();

  if (!slotRequestId) {
    return res.status(400).json({ success: false, message: "Missing slotRequestId" });
  }

  if (!currentClientId) {
    return res.status(401).json({ success: false, message: "Only clients can create payment orders" });
  }

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return res.status(500).json({ success: false, message: "Razorpay configuration missing on server" });
  }

  const slotRequest = await SlotRequest.findById(slotRequestId);
  if (!slotRequest) {
    return res.status(404).json({ success: false, message: "Slot request not found" });
  }

  if (slotRequest.patientId.toString() !== currentClientId) {
    return res.status(403).json({ success: false, message: "You cannot pay for another user's slot" });
  }

  if (slotRequest.status === 'rejected') {
    return res.status(400).json({ success: false, message: "This slot request was rejected" });
  }

  if (slotRequest.paymentStatus === 'paid') {
    return res.status(400).json({ success: false, message: "This slot is already paid" });
  }

  const amount = Number(slotRequest.fee);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: "Invalid slot fee amount" });
  }

  const options = {
    amount: Math.round(amount * 100),
    currency: 'INR',
    receipt: `sr_${slotRequestId.toString().slice(-20)}_${Date.now().toString().slice(-6)}`,
    notes: {
      slotRequestId: slotRequestId.toString(),
      clientId: currentClientId,
      doctorId: slotRequest.doctorId.toString()
    }
  };

  try {
    const order = await razorpay.orders.create(options);
    res.status(200).json({
      success: true,
      order,
      amount,
      keyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to create order", error: err.message });
  }
};

export const verifyPayment = async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    slotRequestId,
  } = req.body;

  const currentClientId = req.client?._id?.toString();
  if (!currentClientId) {
    return res.status(401).json({ success: false, message: "Only clients can verify payments" });
  }

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !slotRequestId) {
    return res.status(400).json({ success: false, message: "Missing required payment verification fields" });
  }

  const generatedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');

  if (generatedSignature !== razorpay_signature) {
    return res.status(400).json({ success: false, message: 'Payment verification failed' });
  }

  try {
    const slotRequest = await SlotRequest.findById(slotRequestId);
    if (!slotRequest) {
      return res.status(404).json({ success: false, message: "Slot request not found" });
    }

    if (slotRequest.patientId.toString() !== currentClientId) {
      return res.status(403).json({ success: false, message: "You cannot verify payment for another user's slot" });
    }

    const existingPayment = await Payment.findOne({ transactionId: razorpay_payment_id });
    if (existingPayment) {
      return res.status(200).json({
        success: true,
        message: "Payment already verified",
        payment: existingPayment
      });
    }

    if (slotRequest.paymentStatus === 'paid') {
      return res.status(200).json({
        success: true,
        message: "Payment already marked as paid for this slot"
      });
    }

    if (slotRequest.status === 'rejected') {
      return res.status(400).json({ success: false, message: "This slot request was rejected" });
    }

    // Update slot request
    slotRequest.paymentStatus = "paid";
    slotRequest.status = "accepted";
    await slotRequest.save();

    // Ensure the schedule slot is permanently booked after successful payment.
    const schedule = await Schedule.findById(slotRequest.scheduleId);
    if (schedule && schedule.slots?.[slotRequest.slotIndex]) {
      schedule.slots[slotRequest.slotIndex].isBooked = true;
      schedule.slots[slotRequest.slotIndex].bookedBy = slotRequest.patientId;
      schedule.slots[slotRequest.slotIndex].requestId = slotRequest._id;
      await schedule.save();
    }

    // Create payment record
    const payment = new Payment({
      slotRequestId,
      doctorId: slotRequest.doctorId,
      patientId: slotRequest.patientId,
      amount: slotRequest.fee,
      status: "success",
      transactionId: razorpay_payment_id,
    });

    await payment.save();

    res.status(200).json({ success: true, message: "Payment verified and recorded", payment });
  } catch (err) {
    res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  }
};



export const getDoctorPaymentHistory = async (req, res) => {
  try {
    const doctorId = req.doctor?._id;

    if (!doctorId) {
      return res.status(400).json({
        success: false,
        message: "Doctor authentication required"
      });
    }

    // Fetch all payments for this doctor with client details
    const payments = await Payment.find({ doctorId })
      .populate({
        path: 'patientId',
        model: 'Client',
        select: 'name email age phone'
      })
      .populate({
        path: 'slotRequestId',
        select: 'date time'
      })
      .sort({ createdAt: -1 }); // Sort by latest first

    // Format the response data
    const paymentHistory = payments.map(payment => ({
      paymentId: payment._id,
      transactionId: payment.transactionId,
      amount: payment.amount,
      status: payment.status,
      paymentGateway: payment.paymentGateway,
      paymentDate: payment.createdAt,
      client: {
        name: payment.patientId?.name || 'N/A',
        email: payment.patientId?.email || 'N/A',
        age: payment.patientId?.age || 'N/A',
        phone: payment.patientId?.phone || 'N/A'
      },
      appointment: {
        date: payment.slotRequestId?.date || 'N/A',
        time: payment.slotRequestId?.time || 'N/A'
      }
    }));

    // Calculate total earnings
    const totalEarnings = payments.reduce((total, payment) => {
      return payment.status === 'success' ? total + payment.amount : total;
    }, 0);

    res.status(200).json({
      success: true,
      data: {
        paymentHistory,
        totalPayments: payments.length,
        totalEarnings,
        successfulPayments: payments.filter(p => p.status === 'success').length
      }
    });

  } catch (error) {
    console.error('Error fetching doctor payment history:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment history",
      error: error.message
    });
  }
};
