import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Loader2 } from "lucide-react";
import type { Todo } from "@shared/schema";

export default function TodosPage() {
  const [newTodo, setNewTodo] = useState("");

  const { data: todos, isLoading } = useQuery<Todo[]>({
    queryKey: ["/api/todos"],
  });

  const addTodo = useMutation({
    mutationFn: async (content: string) => {
      await apiRequest("POST", "/api/todos", { content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/todos"] });
      setNewTodo("");
    },
  });

  const toggleTodo = useMutation({
    mutationFn: async ({
      id,
      completed,
    }: {
      id: number;
      completed: number;
    }) => {
      await apiRequest("PUT", `/api/todos/${id}`, { completed });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/todos"] });
    },
  });

  const deleteTodo = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/todos/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/todos"] });
    },
  });

  const incomplete = (todos || []).filter((t) => !t.completed);
  const completed = (todos || []).filter((t) => t.completed);
  const total = (todos || []).length;
  const doneCount = completed.length;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold">My To-Do</h1>
        {total > 0 && (
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-todo-count">
            {doneCount} of {total} completed
          </p>
        )}
      </div>

      {/* Add todo */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newTodo.trim()) addTodo.mutate(newTodo.trim());
        }}
        className="flex gap-2"
      >
        <Input
          placeholder="Add a new to-do..."
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          className="flex-1"
          data-testid="input-new-todo"
        />
        <Button
          type="submit"
          size="sm"
          disabled={addTodo.isPending || !newTodo.trim()}
          data-testid="button-add-todo"
        >
          {addTodo.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </Button>
      </form>

      {/* Todo list */}
      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : total === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No to-dos yet. Add one above!
              </p>
            </div>
          ) : (
            <>
              {incomplete.map((todo) => (
                <div
                  key={todo.id}
                  className="flex items-center gap-3 px-4 py-3 group"
                  data-testid={`todo-${todo.id}`}
                >
                  <Checkbox
                    checked={false}
                    onCheckedChange={() =>
                      toggleTodo.mutate({ id: todo.id, completed: 1 })
                    }
                    data-testid={`checkbox-todo-${todo.id}`}
                  />
                  <span className="flex-1 text-sm">{todo.content}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    onClick={() => deleteTodo.mutate(todo.id)}
                    data-testid={`button-delete-todo-${todo.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {completed.length > 0 && (
                <>
                  {incomplete.length > 0 && (
                    <div className="px-4 py-2 bg-muted/50">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Completed
                      </span>
                    </div>
                  )}
                  {completed.map((todo) => (
                    <div
                      key={todo.id}
                      className="flex items-center gap-3 px-4 py-3 group"
                      data-testid={`todo-${todo.id}`}
                    >
                      <Checkbox
                        checked={true}
                        onCheckedChange={() =>
                          toggleTodo.mutate({ id: todo.id, completed: 0 })
                        }
                        data-testid={`checkbox-todo-${todo.id}`}
                      />
                      <span className="flex-1 text-sm line-through text-muted-foreground">
                        {todo.content}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        onClick={() => deleteTodo.mutate(todo.id)}
                        data-testid={`button-delete-todo-${todo.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
