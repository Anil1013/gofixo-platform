// Password rule: minimum 8 characters, must contain at least one letter and one number.
// Symbols are allowed but not required.
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d)[\s\S]{8,}$/;

function isValidPassword(password) {
  return typeof password === 'string' && PASSWORD_RULE.test(password);
}

const PASSWORD_ERROR = 'Password must be at least 8 characters and include both letters and numbers (symbols optional)';

module.exports = { isValidPassword, PASSWORD_ERROR };
