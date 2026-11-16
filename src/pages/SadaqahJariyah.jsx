import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import {
  PageHeader,
  Spinner,
  EmptyState,
  useToast,
  useConfirm,
} from "../components/UI";

const EMPTY_FORM = {
  title: "صدقة جارية",
  name: "",
  body: "",
  date: "",
  dua_request: "",
  image_url: "",
};

export default function SadaqahJariyah() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("sadaqah_jariyah")
      .select("*")
      .order("sort_order");
    if (error) toast('تعذّر تحميل البيانات', 'error', error);
    setItems(data || []);
    setLoading(false);
  };

  const add = async () => {
    if (!form.name.trim() || !form.body.trim() || !form.dua_request.trim()) {
      toast("الاسم والنص والدعاء مطلوبين", "error");
      return;
    }
    const { error } = await supabase.from("sadaqah_jariyah").insert({
      title: form.title.trim() || "صدقة جارية",
      name: form.name.trim(),
      body: form.body.trim(),
      date: form.date.trim(),
      dua_request: form.dua_request.trim(),
      image_url: form.image_url.trim() || null,
      sort_order: items.length,
    });
    if (error) {
      toast("تعذّر الإضافة", "error");
      return;
    }
    setForm(EMPTY_FORM);
    toast("تمت الإضافة");
    load();
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditForm({
      title: item.title || "صدقة جارية",
      name: item.name || "",
      body: item.body || "",
      date: item.date || "",
      dua_request: item.dua_request || "",
      image_url: item.image_url || "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
  };

  const saveEdit = async (id) => {
    if (
      !editForm.name.trim() ||
      !editForm.body.trim() ||
      !editForm.dua_request.trim()
    ) {
      toast("الاسم والنص والدعاء مطلوبين", "error");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("sadaqah_jariyah")
      .update({
        title: editForm.title.trim() || "صدقة جارية",
        name: editForm.name.trim(),
        body: editForm.body.trim(),
        date: editForm.date.trim(),
        dua_request: editForm.dua_request.trim(),
        image_url: editForm.image_url.trim() || null,
      })
      .eq("id", id);
    setSaving(false);
    if (error) {
      toast("تعذّر الحفظ", "error");
      return;
    }
    toast("تم حفظ التعديلات");
    setEditingId(null);
    load();
  };

  const remove = async (id) => {
    const ok = await confirm("هتحذف الصدقة الجارية دي، متأكد؟", {
      danger: true,
      confirmLabel: "حذف",
    });
    if (!ok) return;
    const { error } = await supabase.from("sadaqah_jariyah").delete().eq("id", id);
    if (error) { toast('تعذّر الحذف', 'error', error); return; }
    setItems((prev) => prev.filter((i) => i.id !== id));
    toast("تم الحذف");
  };

  return (
    <div>
      <PageHeader
        eyebrow={`${items.length} صدقة جارية`}
        title="الصدقة الجارية"
      />

      <div className="card p-5 mb-8 max-w-2xl space-y-3">
        <p className="text-sm font-bold text-muted">إضافة صدقة جارية جديدة</p>
        <input
          placeholder="الاسم *"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="input-field"
        />
        <textarea
          placeholder="النص/الدعاء الكامل *"
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          rows={4}
          className="input-field"
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            placeholder="التاريخ (اختياري، نص حر زي 23/5/2023)"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="input-field"
          />
          <input
            placeholder="نص الدعوة للدعاء *"
            value={form.dua_request}
            onChange={(e) => setForm({ ...form, dua_request: e.target.value })}
            className="input-field"
          />
        </div>
        <ImageUploadField
          value={form.image_url}
          onChange={(url) => setForm({ ...form, image_url: url })}
        />
        <button onClick={add} className="btn-primary">
          إضافة
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon="🤍" title="مفيش صدقات جارية مسجّلة" />
      ) : (
        <div className="space-y-3 max-w-2xl">
          {items.map((i) => (
            <div key={i.id} className="card p-4">
              {editingId === i.id ? (
                <div className="space-y-3">
                  <p className="text-sm font-bold text-muted">تعديل</p>
                  <input
                    placeholder="الاسم *"
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm({ ...editForm, name: e.target.value })
                    }
                    className="input-field"
                  />
                  <textarea
                    placeholder="النص/الدعاء الكامل *"
                    value={editForm.body}
                    onChange={(e) =>
                      setEditForm({ ...editForm, body: e.target.value })
                    }
                    rows={4}
                    className="input-field"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      placeholder="التاريخ (اختياري)"
                      value={editForm.date}
                      onChange={(e) =>
                        setEditForm({ ...editForm, date: e.target.value })
                      }
                      className="input-field"
                    />
                    <input
                      placeholder="نص الدعوة للدعاء *"
                      value={editForm.dua_request}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          dua_request: e.target.value,
                        })
                      }
                      className="input-field"
                    />
                  </div>
                  <ImageUploadField
                    value={editForm.image_url}
                    onChange={(url) =>
                      setEditForm({ ...editForm, image_url: url })
                    }
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(i.id)}
                      disabled={saving}
                      className="btn-primary text-sm"
                    >
                      {saving ? "جارِ الحفظ..." : "حفظ"}
                    </button>
                    <button onClick={cancelEdit} className="btn-ghost text-sm">
                      إلغاء
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {i.image_url && (
                      <img
                        src={i.image_url}
                        alt={i.name}
                        className="w-12 h-12 rounded-lg object-cover shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{i.name}</p>
                      <p className="text-xs text-muted truncate">{i.body}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => startEdit(i)}
                      className="text-xs font-semibold text-primary px-2 py-1.5"
                    >
                      تعديل
                    </button>
                    <button
                      onClick={() => remove(i.id)}
                      className="text-xs font-semibold text-muted hover:text-coral px-2 py-1.5"
                    >
                      حذف
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// حقل رفع صورة لـ Supabase Storage (bucket: sadaqah) — بيرفع الملف ويحط
// الرابط العام تلقائيًا في image_url. فيه معاينة للصورة الحالية، وزرار مسح.
function ImageUploadField({ value, onChange }) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const toast = useToast();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // يسمح تختار نفس الملف تاني لو حبيت تعيد الرفع
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("لازم تختار ملف صورة", "error");
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("sadaqah")
      .upload(path, file, { upsert: false });
    setUploading(false);
    if (error) {
      toast("تعذّر رفع الصورة", "error");
      return;
    }
    const { data } = supabase.storage.from("sadaqah").getPublicUrl(path);
    onChange(data.publicUrl);
    toast("تم رفع الصورة");
  };

  return (
    <div className="space-y-2">
      <label className="text-xs text-muted font-semibold">صورة (اختياري)</label>
      <div className="flex items-center gap-3">
        {value ? (
          <img
            src={value}
            alt=""
            className="w-14 h-14 rounded-lg object-cover shrink-0 border border-black/10"
          />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-surface shrink-0 flex items-center justify-center text-muted text-xs">
            بلا صورة
          </div>
        )}
        <div className="flex-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="btn-ghost text-xs shrink-0"
          >
            {uploading
              ? "جارِ الرفع..."
              : value
                ? "استبدال الصورة"
                : "رفع صورة"}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="text-xs text-muted hover:text-coral shrink-0"
            >
              مسح الصورة
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="hidden"
        />
      </div>
    </div>
  );
}
