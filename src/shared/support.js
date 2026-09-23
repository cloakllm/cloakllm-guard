// Where to send someone who needs help.
//
// Until v0.1.1 the extension said "please report this" in four places and
// never said where. A health warning is only useful if it reaches us: the
// case it exists for -- a site changing its layout so Guard silently stops
// seeing the message box -- is invisible to us unless a user tells us.
//
// One constant, so the dialog, the popup and the console messages cannot
// drift apart. The anchors are the section ids on cloakllm.dev/guard/support.
export const SUPPORT_URL = 'https://cloakllm.dev/guard/support';

export const HELP = {
  couldNotCheck: `${SUPPORT_URL}#could-not-check`,
  unreachable: `${SUPPORT_URL}#unreachable`,
  report: `${SUPPORT_URL}#report`,
};
