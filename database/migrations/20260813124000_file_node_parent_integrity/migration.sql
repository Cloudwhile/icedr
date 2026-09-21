ALTER TABLE "file_nodes"
ADD CONSTRAINT "file_nodes_parent_node_id_fkey"
FOREIGN KEY ("parent_node_id") REFERENCES "file_nodes"("id")
ON DELETE CASCADE ON UPDATE CASCADE
NOT VALID;

ALTER TABLE "file_nodes"
VALIDATE CONSTRAINT "file_nodes_parent_node_id_fkey";
