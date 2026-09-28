export type Mail = { to: string; subject: string; text: string; link?: string; kind: 'verify' | 'reset' | 'invite' };
export type Mailer = { send(mail: Mail): Promise<void> };
export type DevMailer = Mailer & { inbox(to: string): Mail[] };

export const createDevMailer = (log: (line: string) => void = (line) => console.log(line)): DevMailer => {
  const sent: Mail[] = [];
  return {
    async send(mail) {
      sent.push(mail);
      log(`[mail] ${mail.kind} to=${mail.to} subject="${mail.subject}"${mail.link ? ` link=${mail.link}` : ''}`);
    },
    inbox: (to) => sent.filter((m) => m.to.toLowerCase() === to.toLowerCase()),
  };
};
