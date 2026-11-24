// Uygulamadaki Ayarlar > Skill'ler sayfası için liste. Yerleşik skill'ler salt okunurdur;
// kullanıcının internetten kurduğu skill'ler (`installed: true`) buradan kaldırılabilir.
// Talimat gövdesi ve dosya yolları istemciye gitmez; yalnızca görünen bilgiler.
const { listUserSkills, deleteUserSkill } = require('../skills/userSkills');
const { NAME_PATTERN } = require('../skills/skillStore');

const ASSISTANT_LABELS = {
  '*': 'Her yerde',
  tiger: 'Sohbet',
  deep_research: 'Derin araştırma',
};

function publicSkill(skill) {
  return {
    name: skill.name,
    title: skill.title || skill.name,
    description: skill.description,
    where: skill.assistants.map(id => ASSISTANT_LABELS[id] || id),
    alwaysOn: skill.autoload === true,
  };
}

function publicUserSkill(skill) {
  return { ...publicSkill(skill), installed: true, sourceUrl: skill.sourceUrl, installedAt: skill.installedAt };
}

function registerSkillRoutes(app, { skillStore, firestoreDb }) {
  app.get('/skills', async (req, res) => {
    let installed = [];
    const uid = req.user?.uid;
    if (uid && firestoreDb) {
      try {
        installed = await listUserSkills(firestoreDb, uid);
      } catch (error) {
        console.warn('Kullanıcı skill\'leri okunamadı:', error.message);
      }
    }
    // Yeni kurulan skill hemen görünsün diye önbelleğe alınmaz.
    res.set('Cache-Control', 'private, no-cache');
    res.json({ skills: [...skillStore.list().map(publicSkill), ...installed.map(publicUserSkill)] });
  });

  app.delete('/skills/:name', async (req, res) => {
    const uid = req.user?.uid;
    const { name } = req.params;
    if (!uid || !firestoreDb) return res.status(401).json({ error: 'Oturum gerekli.' });
    if (!NAME_PATTERN.test(name) || name.length > 64) return res.status(400).json({ error: 'Geçersiz skill adı.' });
    if (skillStore.get?.(name)) return res.status(403).json({ error: 'Yerleşik skill\'ler kaldırılamaz.' });
    try {
      if (!await deleteUserSkill(firestoreDb, uid, name)) return res.status(404).json({ error: 'Skill bulunamadı.' });
      return res.json({ deleted: true, name });
    } catch (error) {
      console.error('Skill kaldırılamadı:', error.message);
      return res.status(500).json({ error: 'Skill kaldırılamadı.' });
    }
  });
}

module.exports = { registerSkillRoutes };
