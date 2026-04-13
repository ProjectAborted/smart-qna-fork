import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useCreatePost } from "../hooks/usePosts.js";
import api from "../services/api.js";
import toast from "react-hot-toast";
import SimilarQuestionsPanel from "../components/SimilarQuestionsPanel.jsx";

export default function CreatePost() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: "", body: "", tag_ids: [] });
  const [files, setFiles] = useState([]);
  const { mutateAsync, isPending } = useCreatePost();
  const [similarPosts, setSimilarPosts] = useState([]);
  const [isFetchingSimilar, setIsFetchingSimilar] = useState(false);
  const debounceTimer = useRef(null);

  useEffect(() => {
    const text = form.title.trim();
    if (text.length < 15) {
      setSimilarPosts([]);
      return;
    }
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      setIsFetchingSimilar(true);
      try {
        const [res] = await Promise.all([
          api.post("/posts/similar", { text }),
          new Promise((resolve) => setTimeout(resolve, 2800)),
        ]);
        setSimilarPosts(res.data.results || []);
      } catch {
        setSimilarPosts([]);
      } finally {
        setIsFetchingSimilar(false);
      }
    }, 600);
    return () => clearTimeout(debounceTimer.current);
  }, [form.title]);

  const { data: tags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.get("/tags").then((r) => r.data),
  });

  const toggleTag = (tagId) => {
    setForm((f) => ({
      ...f,
      tag_ids: f.tag_ids.includes(tagId)
        ? f.tag_ids.filter((id) => id !== tagId)
        : [...f.tag_ids, tagId],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return;
    try {
      const post = await mutateAsync(form);
      if (files.length > 0) {
        await Promise.all(
          files.map((file) => {
            const fd = new FormData();
            fd.append("file", file);
            fd.append("post_id", post.post_id);
            return api.post("/attachments/upload", fd);
          })
        );
      }
      toast.success("Question posted!");
      navigate(`/posts/${post.post_id}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to post question");
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Ask a Question</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="card p-5">
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Title
            <span className="font-normal text-gray-500 ml-1">— Be specific and clear</span>
          </label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="input"
            placeholder="e.g. How do I configure Docker networking for my FastAPI app?"
            maxLength={300}
            required
          />
          <p className="text-xs text-gray-400 mt-1">{form.title.length}/300</p>
        </div>

        {/* AI Similar Questions Panel */}
        <SimilarQuestionsPanel
          isLoading={isFetchingSimilar}
          results={similarPosts}
        />

        <div className="card p-5">
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Body
            <span className="font-normal text-gray-500 ml-1">— Describe your problem in detail</span>
          </label>
          <textarea
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            rows={10}
            className="input resize-none"
            placeholder="Include what you've tried, error messages, and relevant code..."
            required
          />
        </div>

        <div className="card p-5">
          <label className="block text-sm font-semibold text-gray-700 mb-3">Tags</label>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag.tag_id}
                type="button"
                onClick={() => toggleTag(tag.tag_id)}
                className={`badge cursor-pointer transition-colors ${
                  form.tag_ids.includes(tag.tag_id)
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {tag.name}
              </button>
            ))}
          </div>
          {form.tag_ids.length > 0 && (
            <p className="text-xs text-gray-500 mt-2">{form.tag_ids.length} tag(s) selected</p>
          )}
        </div>

        <div className="card p-5">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Attachments
            <span className="font-normal text-gray-500 ml-1">— Optional, max 10MB each</span>
          </label>
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,application/zip"
            onChange={(e) => setFiles(Array.from(e.target.files))}
            className="block text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
          />
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 rounded px-2 py-1">
                  <span>{f.name} <span className="text-gray-400">({(f.size / 1024).toFixed(0)} KB)</span></span>
                  <button
                    type="button"
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    className="text-gray-400 hover:text-red-500 ml-2"
                  >✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={isPending} className="btn-primary">
            {isPending ? "Posting..." : "Post Your Question"}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
