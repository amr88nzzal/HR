/** Employee account texts (merged into en.ts) */
export const accountEn = {
  tab: 'Account',
  column: 'Account',
  states: { none: 'No account', invited: 'Invited', active: 'Active', disabled: 'Disabled' },
  noneHint: 'This employee has no login account.',
  create: 'Create account',
  createOnHire: 'Create a user account for the employee',
  email: 'Email',
  emailHint: 'Taken from the employee contacts when left empty',
  username: 'Username',
  lastLogin: 'Last login',
  inviteExpires: 'Invite valid until',
  delivery: 'Activation method',
  deliveries: {
    invite: 'Email invite (one-time link)',
    temp: 'Temporary password',
  },
  resend: 'Resend invite',
  disabledByEmployment:
    'The account was disabled automatically when employment ended, and is re-enabled on rehire.',
  resultTitle: 'Activation details',
  inviteSent:
    'An invite was sent to {{email}}. This link is a fallback if the email does not arrive:',
  tempCreated:
    'Account created for {{email}}. Give the employee the temporary password (changed at first login):',
  shownOnce: 'This value is shown once only and is not stored.',
  copy: 'Copy',
  copied: 'Copied',
  done: 'Done',
  accept: {
    title: 'Activate your account',
    password: 'New password',
    confirm: 'Confirm password',
    submit: 'Set password',
    mismatch: 'Passwords do not match',
    done: 'Password set. You can now sign in.',
    login: 'Sign in',
    errors: {
      INVALID_INVITE: 'The invite link is invalid or expired; ask HR to send a new one.',
      generic: 'Could not set the password',
    },
  },
};
