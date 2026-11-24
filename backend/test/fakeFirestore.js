// memoryStore'un kullandığı Firestore alt kümesini bellekte taklit eder.
function fakeFirestore() {
  const docs = new Map();
  let txQueue = Promise.resolve();
  const docRef = path => ({
    path,
    id: path.split('/').pop(),
    collection: name => collectionRef(`${path}/${name}`),
    get: async () => snapshot(path),
    set: async (data, options) => { docs.set(path, options?.merge ? { ...docs.get(path), ...data } : { ...data }); },
    delete: async () => { docs.delete(path); },
  });
  // Gerçek Firestore gibi anlık görüntü: okunduktan sonraki değişiklikler etkilemez.
  const snapshot = path => {
    const value = docs.get(path);
    return { id: path.split('/').pop(), ref: docRef(path), exists: docs.has(path), data: () => value };
  };
  const collectionRef = (path, max = Infinity, filter = () => true) => ({
    doc: id => docRef(`${path}/${id}`),
    limit: n => collectionRef(path, n, filter),
    where: (field, op, value) => collectionRef(path, max, data => filter(data) && (op === '<=' ? data?.[field] <= value : op === '>=' ? data?.[field] >= value : data?.[field] === value)),
    get: async () => {
      const matches = [...docs.keys()]
        .filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .filter(key => filter(docs.get(key)))
        .slice(0, max)
        .map(snapshot);
      return { docs: matches, empty: matches.length === 0, size: matches.length };
    },
  });
  return {
    docs,
    collection: name => collectionRef(name),
    runTransaction: fn => {
      const next = txQueue.then(() => fn({ get: ref => ref.get(), getAll: (...refs) => Promise.all(refs.map(ref => ref.get())), set: (ref, data, options) => ref.set(data, options), delete: ref => ref.delete() }));
      txQueue = next.catch(() => {});
      return next;
    },
    batch: () => {
      const ops = [];
      return { delete: ref => ops.push(ref), commit: async () => { for (const ref of ops) await ref.delete(); } };
    },
  };
}

module.exports = { fakeFirestore };
