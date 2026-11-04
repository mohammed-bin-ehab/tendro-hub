const express = require('express');
const { needLogin } = require('../auth');
const { SECURE } = require('../config');
const { canViewProject } = require('../projects');

const router = express.Router();
// switch the project shown on the dashboard and /flow (remembered in a cookie; only projects the user may see)
router.get('/project/:id', needLogin, async (req, res) => {
  const id = Number(req.params.id);
  if (await canViewProject(req.user, id)) {
    res.setHeader('Set-Cookie', `project=${id}; SameSite=Lax; Path=/; Max-Age=31536000${SECURE ? '; Secure' : ''}`);
  }
  const back = String(req.query.to || '');
  res.redirect(back === 'flow' ? '/flow' : '/');
});
module.exports = router;
