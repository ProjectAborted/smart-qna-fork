import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api.js";
import { useAuth } from "../hooks/useAuth.js";
import toast from "react-hot-toast";

export default function CommentThread({ comments, postId, answerId }) {
  const { user } = useAuth();
  const [newComment, setNewComment] = useState("");
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const endpoint = postId
    ? `/posts/${postId}/comments`
    : `/answers/${answerId}/comments`;

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post(endpoint, { body }).then((r) => r.data),
    onSuccess: () => {
      setNewComment("");
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["post"] });
      toast.success("Comment added");
    },
    onError: (err) => toast.error(err.response?.data?.detail || "Failed to add comment"),
  });

    const { mutate: deleteComment } = useMutation({
    mutationFn: (commentId) => api.delete(`/comments/${commentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post"] });
      toast.success("Comment deleted");
    },
    onError: (err) => toast.error(err.response?.data?.detail || "Failed to delete comment"),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    mutate(newComment.trim());
  };

const isMod = role === "TA" || role === "ADMIN";

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      {comments?.map((comment) => {
        const isOwnComment = user?.user_id === comment.author_id;
        const canDelete = isOwnComment || isMod;

        return (
          <div key={comment.comment_id} className="flex gap-2 py-1.5 text-sm group">
            <div className="w-5 h-5 rounded-full bg-gray-400 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">
              {comment.author?.display_name[0]?.toUpperCase()}
            </div>
            <div className="flex-1">
              <span className="text-gray-700">{comment.body}</span>
              <span className="text-gray-400 text-xs ml-2">
                — {comment.author?.display_name},{" "}
                {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
              </span>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => deleteComment(comment.comment_id)}
                  className="ml-2 text-xs text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 transition-opacity"
                  title="Delete comment"
                  aria-label="Delete comment"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}

      {user && (
        showForm ? (
          <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
            <input
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a comment..."
              className="input flex-1 text-sm py-1"
              autoFocus
            />
            <button type="submit" disabled={isPending} className="btn-primary text-xs py-1">
              {isPending ? "..." : "Add"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-xs py-1">
              Cancel
            </button>
          </form>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs text-blue-600 hover:text-blue-700 mt-1"
          >
            Add a comment
          </button>
        )
      )}
    </div>
  );
}