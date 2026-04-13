import { useParams, Link, useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { usePost, useVotePost, useVoteAnswer, useAcceptAnswer } from "../hooks/usePosts.js";
import { useAuth } from "../hooks/useAuth.js";
import VoteButton from "../components/VoteButton.jsx";
import TagBadge from "../components/TagBadge.jsx";
import AnswerForm from "../components/AnswerForm.jsx";
import CommentThread from "../components/CommentThread.jsx";
import toast from "react-hot-toast";
import api from "../services/api.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";

const STATUS_COLORS = {
  OPEN: "bg-green-100 text-green-800",
  SOLVED: "bg-blue-100 text-blue-800",
  CLOSED: "bg-gray-100 text-gray-600",
};

export default function PostDetail() {
  const { postId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: post, isLoading, isError } = usePost(postId);
  const { mutate: votePost, isPending: votingPost } = useVotePost();
  const { mutate: voteAnswer, isPending: votingAnswer } = useVoteAnswer();
  const { mutate: acceptAnswer } = useAcceptAnswer();

  const { mutate: deletePost } = useMutation({
    mutationFn: () => api.delete(`/posts/${postId}`),
    onSuccess: () => { toast.success("Post deleted"); navigate("/"); },
    onError: () => toast.error("Failed to delete post"),
  });

  const { mutate: closePost } = useMutation({
    mutationFn: () => api.post(`/posts/${postId}/close`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["post", postId] }),
  });

  const { mutate: pinPost } = useMutation({
    mutationFn: () => api.post(`/posts/${postId}/pin`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["post", postId] }),
  });

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-3/4" />
        <div className="h-4 bg-gray-200 rounded w-1/4" />
        <div className="card p-6 space-y-3">
          <div className="h-4 bg-gray-200 rounded" />
          <div className="h-4 bg-gray-200 rounded" />
          <div className="h-4 bg-gray-200 rounded w-3/4" />
        </div>
      </div>
    );
  }

  if (isError || !post) {
    return (
      <div className="max-w-4xl mx-auto text-center py-12">
        <p className="text-xl font-medium text-gray-700">Question not found.</p>
        <Link to="/" className="btn-primary mt-4 inline-flex">Back to Feed</Link>
      </div>
    );
  }

  const isAuthor = user?.user_id === post.author_id;
  const isMod = user?.role === "TA" || user?.role === "ADMIN";
  const isAdmin = user?.role === "ADMIN";

  return (
    <div className="max-w-4xl mx-auto">
      {/* Post header */}
      <div className="mb-4">
        <div className="flex items-start gap-3 mb-2">
          <span className={`badge ${STATUS_COLORS[post.status]}`}>{post.status}</span>
          {post.is_pinned && <span className="badge bg-blue-100 text-blue-700">📌 Pinned</span>}
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{post.title}</h1>
        <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-gray-500">
          <span>Asked {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}</span>
          <span>{post.view_count} views</span>
          <span>{post.answer_count} answers</span>
        </div>
      </div>

      {/* Post body */}
      <div className="card p-6 mb-6">
        <div className="flex gap-4">
          <VoteButton
            count={post.vote_count}
            userVote={post.user_vote}
            onUpvote={() => votePost({ postId, type: "UP" }, { onError: (e) => toast.error(e.response?.data?.detail || "Vote failed") })}
            onDownvote={() => votePost({ postId, type: "DOWN" }, { onError: (e) => toast.error(e.response?.data?.detail || "Vote failed") })}
            disabled={votingPost}
          />
          <div className="flex-1 min-w-0">
            <div className="prose prose-sm max-w-none text-gray-800 whitespace-pre-wrap">
              {post.body}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-4">
              {post.tags?.map((tag) => <TagBadge key={tag.tag_id} tag={tag} />)}
            </div>
            {post.attachments?.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-gray-500 mb-2">Attachments</p>
                <div className="flex flex-wrap gap-2">
                  {post.attachments.map((att) =>
                    att.content_type.startsWith("image/") ? (
                      <a key={att.attachment_id} href={att.url} target="_blank" rel="noreferrer">
                        <img src={att.url} alt={att.filename} className="h-24 w-24 object-cover rounded border border-gray-200 hover:opacity-80" />
                      </a>
                    ) : (
                      <a
                        key={att.attachment_id}
                        href={att.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-200 text-gray-700"
                      >
                        📎 {att.filename}
                      </a>
                    )
                  )}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2 text-sm">
                <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                  {post.author?.display_name[0]?.toUpperCase()}
                </div>
                <div>
                  <span className="font-medium text-gray-900">{post.author?.display_name}</span>
                  <span className="text-gray-500 ml-2 text-xs">{post.author?.role}</span>
                </div>
              </div>
              <div className="flex gap-2">
                {isMod && (
                  <>
                    <button onClick={() => pinPost()} className="btn-secondary text-xs py-1">
                      {post.is_pinned ? "Unpin" : "Pin"}
                    </button>
                    {post.status !== "CLOSED" && (
                      <button onClick={() => closePost()} className="btn-secondary text-xs py-1">
                        Close
                      </button>
                    )}
                  </>
                )}
                {isAdmin && (
                  <button onClick={() => { if (confirm("Delete this post?")) deletePost(); }} className="btn-danger text-xs py-1">
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        <CommentThread comments={post.comments} postId={postId} />
      </div>

      {/* Answers */}
      <h2 className="text-lg font-bold text-gray-900 mb-3">
        {post.answers?.length} {post.answers?.length === 1 ? "Answer" : "Answers"}
      </h2>

      <div className="space-y-4 mb-6">
        {post.answers?.sort((a, b) => b.is_accepted - a.is_accepted || b.vote_count - a.vote_count).map((answer) => (
          <div
            key={answer.answer_id}
            className={`card p-6 ${answer.is_accepted ? "border-l-4 border-l-green-500 bg-green-50/30" : ""}`}
          >
            <div className="flex gap-4">
              <div className="flex flex-col items-center gap-1">
                <VoteButton
                  count={answer.vote_count}
                  userVote={answer.user_vote}
                  onUpvote={() => voteAnswer({ answerId: answer.answer_id, postId, type: "UP" })}
                  onDownvote={() => voteAnswer({ answerId: answer.answer_id, postId, type: "DOWN" })}
                  disabled={votingAnswer}
                />
                {answer.is_accepted && (
                  <div className="text-green-600 mt-1" title="Accepted answer">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" />
                    </svg>
                  </div>
                )}
                {isAuthor && !answer.is_accepted && post.status !== "CLOSED" && (
                  <button
                    onClick={() => acceptAnswer(answer.answer_id, {
                      onSuccess: () => toast.success("Answer accepted!"),
                      onError: () => toast.error("Failed to accept answer"),
                    })}
                    className="text-xs text-gray-400 hover:text-green-600 mt-1"
                    title="Accept this answer"
                  >
                    ✓ Accept
                  </button>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="prose prose-sm max-w-none text-gray-800 whitespace-pre-wrap">
                  {answer.body}
                </div>
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="w-6 h-6 rounded-full bg-gray-500 flex items-center justify-center text-white text-xs font-bold">
                      {answer.author?.display_name[0]?.toUpperCase()}
                    </div>
                    <span className="font-medium text-gray-800">{answer.author?.display_name}</span>
                    <span className="text-gray-400 text-xs">
                      {formatDistanceToNow(new Date(answer.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
                <CommentThread comments={answer.comments} answerId={answer.answer_id} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Answer form */}
      {user && post.status !== "CLOSED" ? (
        <AnswerForm postId={postId} />
      ) : !user ? (
        <div className="card p-6 text-center">
          <p className="text-gray-600">
            <Link to="/login" className="text-blue-600 hover:underline font-medium">Sign in</Link> to post an answer.
          </p>
        </div>
      ) : null}
    </div>
  );
}
