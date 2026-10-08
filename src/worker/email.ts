export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(
  env: Env,
  options: SendEmailOptions
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const fromAddress = env.FROM_ADDRESS || 'noreply@dueping.toreal.site';
  const fromName = 'dueping';

  try {
    console.log(`[dueping Email Sending] To: ${options.to}, Subject: ${options.subject}`);
    const res = await env.EMAIL.send({
      to: options.to,
      from: {
        email: fromAddress,
        name: fromName,
      },
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    console.log(`[dueping Email Success] Message ID: ${res?.messageId || 'simulated'}`);
    return { success: true, messageId: res?.messageId };
  } catch (err: any) {
    console.error(`[dueping Email Error] To: ${options.to}, Error:`, err);
    return { success: false, error: err?.message || String(err) };
  }
}
