/**
 * Server-Side EmailJS REST API Client
 * Strictly restricted to server routes (Route Handlers).
 * Handles OTP dispatch and reservation booking confirmations.
 */

export interface SendOtpParams {
  toEmail: string;
  toName: string;
  otpCode: string;
  expiresIn?: string;
}

export interface SendConfirmationParams {
  toEmail: string;
  toName: string;
  referenceCode: string;
  movieTitle: string;
  cinema: string;
  showtime: string;
  seats: string;
  totalAmount: string | number;
}

export interface EmailDispatchResult {
  success: boolean;
  simulated?: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Dispatches a verification email containing the 6-digit OTP code using EmailJS.
 */
export async function sendOtpEmail(params: SendOtpParams): Promise<EmailDispatchResult> {
  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_OTP_TEMPLATE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY;
  const privateKey = process.env.EMAILJS_PRIVATE_KEY;

  // Development / Unconfigured Fallback
  if (!serviceId || !templateId || !publicKey || serviceId.includes('xxxxxxx') || publicKey.includes('placeholder')) {
    console.info(`[EmailJS Dev Fallback] Dispatched OTP code [${params.otpCode}] to [${params.toEmail}] (Name: ${params.toName}).`);
    return {
      success: true,
      simulated: true,
    };
  }

  try {
    const payload = {
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: privateKey,
      template_params: {
        to_email: params.toEmail,
        to_name: params.toName,
        otp_code: params.otpCode,
        expires_in: params.expiresIn || '5 minutes',
      },
    };

    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[EmailJS Error] HTTP ${response.status}: ${errorText}`);
      return {
        success: false,
        error: `EmailJS responded with status ${response.status}: ${errorText}`,
      };
    }

    return { success: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown network failure';
    console.error(`[EmailJS Network Exception] ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Dispatches a booking confirmation email using EmailJS.
 * Non-fatal email boundary: call without blocking main transaction.
 */
export async function sendBookingConfirmationEmail(params: SendConfirmationParams): Promise<EmailDispatchResult> {
  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_CONFIRM_TEMPLATE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY;
  const privateKey = process.env.EMAILJS_PRIVATE_KEY;

  if (!serviceId || !templateId || !publicKey || serviceId.includes('xxxxxxx') || publicKey.includes('placeholder')) {
    console.info(`[EmailJS Dev Fallback] Booking confirmation dispatched to [${params.toEmail}] for Reference [${params.referenceCode}].`);
    return {
      success: true,
      simulated: true,
    };
  }

  try {
    const payload = {
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: privateKey,
      template_params: {
        to_email: params.toEmail,
        to_name: params.toName,
        reference_code: params.referenceCode,
        movie_title: params.movieTitle,
        cinema: params.cinema,
        showtime: params.showtime,
        seats: params.seats,
        total_amount: params.totalAmount,
      },
    };

    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[EmailJS Booking Confirmation Error] HTTP ${response.status}: ${errorText}`);
      return {
        success: false,
        error: `EmailJS responded with ${response.status}: ${errorText}`,
      };
    }

    return { success: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown network failure';
    console.error(`[EmailJS Booking Confirmation Network Exception] ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
    };
  }
}
